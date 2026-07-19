import * as esbuild from 'esbuild-wasm';
import type {
  BuildOptions,
  BuildResult,
  InitializeOptions,
  Loader,
  Message,
  PartialMessage,
  Plugin,
} from 'esbuild-wasm';
import type {
  ScriptCompileFailure,
  ScriptCompileRequest,
  ScriptCompileResult,
  ScriptCompileSuccess,
  ScriptDiagnostic,
  ScriptDiagnosticNote,
} from './compilerProtocol';
import {
  STUDIO_SDK_MODULE_ID,
  STUDIO_SDK_RUNTIME_MODULE_SOURCE,
} from './studioSdkContract';
import {
  normalizeVirtualPath,
  resolveVirtualImport,
  createVirtualProjectSnapshot,
  VirtualFileSystemError,
  type VirtualProjectSnapshot,
} from './virtualFileSystem';

const STUDIO_SDK_INTERNAL_PATH = '/__threejs_studio__/sdk.js';

export { STUDIO_SDK_MODULE_ID } from './studioSdkContract';

export interface EsbuildCompilerAdapter {
  readonly version: string;
  initialize(options: InitializeOptions): Promise<void>;
  build(options: BuildOptions): Promise<BuildResult>;
}

export interface ScriptCompilerOptions {
  readonly adapter?: EsbuildCompilerAdapter;
  /** Omit in Node. A dedicated browser Worker should provide this with worker:false. */
  readonly initialize?: InitializeOptions | false;
}

const initializationByAdapter = new WeakMap<object, Promise<void>>();
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

function asAdapter(): EsbuildCompilerAdapter {
  return {
    version: esbuild.version,
    initialize: esbuild.initialize,
    build: (options) => esbuild.build(options),
  };
}

const DEFAULT_ESBUILD_ADAPTER = asAdapter();

function loaderForPath(path: string): Loader {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.js')) return 'js';
  if (path.endsWith('.json')) return 'json';
  return 'ts';
}

function diagnosticCode(message: Pick<Message, 'id' | 'text'>, fallback: string) {
  if (message.id) return message.id.toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
  const tagged = /^\[([A-Z][A-Z0-9_]+)]\s*/.exec(message.text);
  return tagged?.[1] ?? fallback;
}

function cleanDiagnosticMessage(message: string) {
  return message.replace(/^\[[A-Z][A-Z0-9_]+]\s*/, '');
}

function utf16ColumnFromUtf8(lineText: string, byteColumn: number) {
  const bytes = utf8Encoder.encode(lineText);
  return utf8Decoder.decode(bytes.slice(0, Math.max(0, byteColumn))).length + 1;
}

function serializeNote(note: Message['notes'][number]): ScriptDiagnosticNote {
  return {
    message: note.text,
    filePath: note.location?.file ? stripNamespace(note.location.file) : null,
    line: note.location?.line ?? null,
    column: note.location ? utf16ColumnFromUtf8(note.location.lineText, note.location.column) : null,
  };
}

function serializeMessage(message: Message, severity: ScriptDiagnostic['severity']): ScriptDiagnostic {
  const location = message.location;
  const source = message.pluginName === 'studio-vfs' ? 'vfs' : 'esbuild';
  return {
    severity,
    code: diagnosticCode(message, severity === 'error' ? 'ESBUILD_ERROR' : 'ESBUILD_WARNING'),
    source,
    message: cleanDiagnosticMessage(message.text),
    filePath: location?.file ? stripNamespace(location.file) : null,
    line: location?.line ?? null,
    column: location ? utf16ColumnFromUtf8(location.lineText, location.column) : null,
    length: location?.length ?? null,
    lineText: location?.lineText ?? null,
    notes: message.notes.map(serializeNote),
  };
}

function stripNamespace(path: string) {
  const stripped = path.replace(/^studio-vfs:/, '');
  if (stripped.startsWith('/') || stripped.startsWith('<') || stripped === STUDIO_SDK_MODULE_ID) return stripped;
  return `/${stripped}`;
}

function sortDiagnostics(diagnostics: ScriptDiagnostic[]) {
  return diagnostics.sort((left, right) => (
    left.severity.localeCompare(right.severity)
    || (left.filePath ?? '').localeCompare(right.filePath ?? '')
    || (left.line ?? 0) - (right.line ?? 0)
    || (left.column ?? 0) - (right.column ?? 0)
    || left.message.localeCompare(right.message)
  ));
}

function requestDiagnostic(code: string, message: string, filePath: string | null = null): ScriptDiagnostic {
  return {
    severity: 'error',
    code,
    source: 'request',
    message,
    filePath,
    line: null,
    column: null,
    length: null,
    lineText: null,
    notes: [],
  };
}

function compilerDiagnostic(code: string, message: string): ScriptDiagnostic {
  return { ...requestDiagnostic(code, message), source: 'compiler' };
}

function failure(
  request: ScriptCompileRequest,
  compilerVersion: string,
  diagnostics: readonly ScriptDiagnostic[],
): ScriptCompileFailure {
  return {
    ok: false,
    requestId: request.requestId,
    projectRevision: request.projectRevision,
    entryPath: request.entryPath,
    compilerVersion,
    diagnostics,
  };
}

function validateRequest(request: ScriptCompileRequest): ScriptDiagnostic[] {
  const diagnostics: ScriptDiagnostic[] = [];
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(request.requestId)) {
    diagnostics.push(requestDiagnostic('INVALID_REQUEST_ID', 'requestId must be a stable identifier with at most 128 characters.'));
  }
  if (!Number.isSafeInteger(request.projectRevision) || request.projectRevision < 0) {
    diagnostics.push(requestDiagnostic('INVALID_PROJECT_REVISION', 'projectRevision must be a non-negative safe integer.'));
  }
  if (request.mode !== 'development' && request.mode !== 'production') {
    diagnostics.push(requestDiagnostic('INVALID_COMPILE_MODE', 'mode must be development or production.'));
  }
  if (request.snapshot.revision !== request.projectRevision) {
    diagnostics.push(requestDiagnostic(
      'REVISION_MISMATCH',
      `Snapshot revision ${request.snapshot.revision} does not match requested project revision ${request.projectRevision}.`,
    ));
  }
  return diagnostics;
}

function partialError(code: string, text: string, file: string | null = null): PartialMessage {
  return {
    text: `[${code}] ${text}`,
    location: file ? { file, line: 1, column: 0, length: 0, lineText: '' } : null,
  };
}

function createVirtualFilePlugin(snapshot: VirtualProjectSnapshot, dependencies: Set<string>): Plugin {
  const files = new Map(snapshot.files.map((file) => [file.path, file.contents]));
  return {
    name: 'studio-vfs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === STUDIO_SDK_MODULE_ID) {
          // Keep the public import specifier out of emitted source labels and
          // source maps. The allowlisted module is bundled below, so runtime
          // output should only retain this private virtual path.
          return { path: STUDIO_SDK_INTERNAL_PATH, namespace: 'studio-sdk' };
        }

        if (args.kind === 'entry-point') {
          try {
            const entryPath = normalizeVirtualPath(args.path);
            if (!files.has(entryPath)) {
              return { errors: [partialError('ENTRY_NOT_FOUND', `Entry script "${entryPath}" does not exist.`, entryPath)] };
            }
            dependencies.add(entryPath);
            return { path: entryPath, namespace: 'studio-vfs' };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid entry script path.';
            return { errors: [partialError('INVALID_ENTRY_PATH', message)] };
          }
        }

        if (!args.path.startsWith('.') && !args.path.startsWith('/')) {
          return {
            errors: [partialError(
              'UNSUPPORTED_IMPORT',
              `Import "${args.path}" is not available. Scripts may import project files and ${STUDIO_SDK_MODULE_ID}.`,
              stripNamespace(args.importer),
            )],
          };
        }

        try {
          const importer = stripNamespace(args.importer);
          const resolved = resolveVirtualImport(snapshot, args.path, importer);
          if (!resolved) {
            return {
              errors: [partialError(
                'IMPORT_NOT_FOUND',
                `Cannot resolve "${args.path}" from "${importer}".`,
                importer,
              )],
            };
          }
          dependencies.add(resolved);
          return { path: resolved, namespace: 'studio-vfs' };
        } catch (error) {
          const message = error instanceof Error ? error.message : `Cannot resolve "${args.path}".`;
          return { errors: [partialError('INVALID_IMPORT_PATH', message, stripNamespace(args.importer))] };
        }
      });

      build.onLoad({ filter: /.*/, namespace: 'studio-sdk' }, () => ({
        contents: STUDIO_SDK_RUNTIME_MODULE_SOURCE,
        loader: 'js',
      }));

      build.onLoad({ filter: /.*/, namespace: 'studio-vfs' }, (args) => {
        const contents = files.get(args.path);
        if (contents === undefined) {
          return { errors: [partialError('FILE_NOT_FOUND', `Virtual file "${args.path}" does not exist.`, args.path)] };
        }
        return {
          contents,
          loader: loaderForPath(args.path),
          resolveDir: args.path.slice(0, args.path.lastIndexOf('/')) || '/',
        };
      });
    },
  };
}

function buildFailureMessages(error: unknown): { errors: Message[]; warnings: Message[] } | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { errors?: unknown; warnings?: unknown };
  if (!Array.isArray(candidate.errors) || !Array.isArray(candidate.warnings)) return null;
  return { errors: candidate.errors as Message[], warnings: candidate.warnings as Message[] };
}

async function sha256Hex(value: string) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable.');
  const hash = await globalThis.crypto.subtle.digest('SHA-256', utf8Encoder.encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class ScriptCompilerService {
  readonly #adapter: EsbuildCompilerAdapter;
  readonly #initializeOptions: InitializeOptions | false;
  #latestGeneration = 0;
  #lastSuccessfulGeneration = 0;
  #lastSuccessfulResult: ScriptCompileSuccess | null = null;

  constructor(options: ScriptCompilerOptions = {}) {
    this.#adapter = options.adapter ?? DEFAULT_ESBUILD_ADAPTER;
    this.#initializeOptions = options.initialize ?? false;
  }

  get compilerVersion() {
    return this.#adapter.version;
  }

  getLastSuccessfulResult(): ScriptCompileSuccess | null {
    return this.#lastSuccessfulResult ? structuredClone(this.#lastSuccessfulResult) : null;
  }

  async #ensureInitialized() {
    if (this.#initializeOptions === false) return;
    let pending = initializationByAdapter.get(this.#adapter as object);
    if (!pending) {
      pending = this.#adapter.initialize(this.#initializeOptions);
      initializationByAdapter.set(this.#adapter as object, pending);
    }
    await pending;
  }

  async compile(request: ScriptCompileRequest): Promise<ScriptCompileResult> {
    const generation = ++this.#latestGeneration;
    const requestDiagnostics = validateRequest(request);
    if (requestDiagnostics.length > 0) return failure(request, this.compilerVersion, requestDiagnostics);

    let entryPath: string;
    let snapshot: VirtualProjectSnapshot;
    try {
      entryPath = normalizeVirtualPath(request.entryPath);
      snapshot = createVirtualProjectSnapshot(request.snapshot.files, request.snapshot.revision);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid entry script path.';
      const code = error instanceof VirtualFileSystemError ? error.code : 'INVALID_ENTRY_PATH';
      return failure(request, this.compilerVersion, [requestDiagnostic(code, message)]);
    }

    const dependencies = new Set<string>();
    const buildOptions: BuildOptions = {
      absWorkingDir: '/',
      bundle: true,
      charset: 'utf8',
      entryPoints: [entryPath],
      format: 'esm',
      legalComments: 'none',
      logLevel: 'silent',
      metafile: true,
      minify: request.mode === 'production',
      outfile: '/dist/behavior.js',
      platform: 'browser',
      plugins: [createVirtualFilePlugin(snapshot, dependencies)],
      sourcemap: request.mode === 'development' ? 'external' : false,
      sourcesContent: true,
      target: 'es2022',
      treeShaking: true,
      tsconfigRaw: {
        compilerOptions: {
          alwaysStrict: true,
          strict: true,
          target: 'es2022',
          useDefineForClassFields: true,
          verbatimModuleSyntax: true,
        },
      },
      write: false,
    };

    try {
      await this.#ensureInitialized();
      const buildResult = await this.#adapter.build(buildOptions);
      const diagnostics = sortDiagnostics([
        ...buildResult.errors.map((message) => serializeMessage(message, 'error')),
        ...buildResult.warnings.map((message) => serializeMessage(message, 'warning')),
      ]);
      if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        return failure(request, this.compilerVersion, diagnostics);
      }
      const outputFiles = buildResult.outputFiles ?? [];
      const javascript = outputFiles.find((file) => file.path.endsWith('.js'))?.text;
      if (javascript === undefined) {
        return failure(request, this.compilerVersion, [compilerDiagnostic('OUTPUT_MISSING', 'Compiler produced no JavaScript output.')]);
      }
      const sourceMap = outputFiles.find((file) => file.path.endsWith('.js.map'))?.text ?? null;
      const sortedDependencies = [...dependencies].sort((left, right) => left.localeCompare(right));
      // The runtime treats this digest as the approval identity of the exact
      // ESM bytes it executes, so source maps and compiler metadata must not be
      // mixed into it. The sandbox recomputes this SHA-256 before import.
      const contentHash = await sha256Hex(javascript);
      const success: ScriptCompileSuccess = {
        ok: true,
        requestId: request.requestId,
        projectRevision: request.projectRevision,
        entryPath,
        compilerVersion: this.compilerVersion,
        diagnostics,
        javascript,
        sourceMap,
        dependencies: sortedDependencies,
        contentHash,
        semanticDiagnosticsIncluded: false,
      };
      if (generation >= this.#lastSuccessfulGeneration && generation === this.#latestGeneration) {
        this.#lastSuccessfulGeneration = generation;
        this.#lastSuccessfulResult = structuredClone(success);
      }
      return success;
    } catch (error) {
      const buildMessages = buildFailureMessages(error);
      if (buildMessages) {
        const diagnostics = sortDiagnostics([
          ...buildMessages.errors.map((message) => serializeMessage(message, 'error')),
          ...buildMessages.warnings.map((message) => serializeMessage(message, 'warning')),
        ]);
        return failure(request, this.compilerVersion, diagnostics);
      }
      const message = error instanceof Error ? error.message : 'Unknown compiler failure.';
      return failure(request, this.compilerVersion, [compilerDiagnostic('COMPILER_UNAVAILABLE', message)]);
    }
  }
}

export function createWorkerScriptCompiler(wasmURL: string | URL, adapter?: EsbuildCompilerAdapter) {
  return new ScriptCompilerService({
    adapter,
    initialize: { wasmURL, worker: false },
  });
}

export function isVirtualFileSystemError(error: unknown): error is VirtualFileSystemError {
  return error instanceof VirtualFileSystemError;
}
