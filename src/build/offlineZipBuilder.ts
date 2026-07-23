import { zip, type AsyncZippable, type ZipOptions } from 'fflate';
import {
  RUNTIME_PREVIEW_ALLOW,
  RUNTIME_PREVIEW_SANDBOX,
  RUNTIME_PREVIEW_TRANSPORT,
  RUNTIME_PREVIEW_TRANSPORT_VERSION,
  createRuntimePreviewDocument,
} from '../runtime/RuntimePreviewHost';
import {
  createAuthoredBehaviorPreviewSource,
  createBehaviorPreviewSnapshot,
} from '../runtime/behaviorPreviewRuntime';
import {
  RUNTIME_IFRAME_PROTOCOL,
  RUNTIME_IFRAME_PROTOCOL_VERSION,
} from '../runtime/protocol';
import { sha256Hex } from './hash';
import { normalizeBuildFilename, normalizeBuildPath } from './paths';
import {
  BUILD_PROFILES,
  type BuildBundleInput,
  type BuildCompression,
  type BuildFileContents,
  type BuildFileInput,
  type BuildManifest,
  type BuildManifestFile,
  type BuildManifestFileKind,
  type BuildProfileMetadata,
  type BuildProgress,
  type BuildRequest,
  type BuildResult,
} from './types';

export const OFFLINE_BUILD_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "font-src 'self' data:",
  "form-action 'none'",
  "frame-src 'self'",
  "img-src 'self' blob: data:",
  "manifest-src 'self'",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

const FIXED_ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0, 0);
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const MODULE_EXTENSION = /\.(?:mjs|js)$/iu;
const SCRIPT_ARTIFACT_SUFFIX = '.module-artifact';
const SCRIPT_SOURCE_CATALOG_FORMAT = 'threejs-studio.source-catalog.v1';
const STORED_EXTENSIONS = /\.(?:avif|br|gif|glb|gz|ico|jpe?g|ktx2|mp3|mp4|ogg|png|webm|webp|woff2|zip)$/iu;

interface PreparedFile {
  path: string;
  kind: BuildManifestFileKind;
  mediaType: string;
  bytes: Uint8Array;
  compression: BuildCompression;
}

function comparePaths(left: { path: string }, right: { path: string }): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

export class BuildValidationError extends Error {
  readonly code = 'invalid_build_request';

  constructor(message: string) {
    super(message);
    this.name = 'BuildValidationError';
  }
}

export class BuildCancelledError extends Error {
  readonly code = 'build_cancelled';

  constructor(readonly reason?: unknown) {
    super('The build was cancelled.');
    this.name = 'BuildCancelledError';
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new BuildCancelledError(signal.reason);
}

function emitProgress(
  request: Pick<BuildRequest, 'onProgress' | 'signal'>,
  progress: BuildProgress,
): void {
  request.onProgress?.(Object.freeze({ ...progress }));
  throwIfCancelled(request.signal);
}

function toBytes(contents: BuildFileContents): Uint8Array {
  if (typeof contents === 'string') return TEXT_ENCODER.encode(contents);
  if (contents instanceof Uint8Array) return new Uint8Array(contents);
  if (contents instanceof ArrayBuffer) return new Uint8Array(contents.slice(0));
  throw new BuildValidationError('Build file contents must be a string, Uint8Array, or ArrayBuffer.');
}

function mediaTypeForPath(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return ({
    css: 'text/css; charset=utf-8',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    html: 'text/html; charset=utf-8',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    ktx2: 'image/ktx2',
    mjs: 'text/javascript; charset=utf-8',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    ogg: 'audio/ogg',
    png: 'image/png',
    svg: 'image/svg+xml',
    wasm: 'application/wasm',
    webm: 'video/webm',
    webp: 'image/webp',
    woff2: 'font/woff2',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

function prepareInput(input: BuildFileInput, namespace: string, kind: BuildManifestFileKind): PreparedFile {
  const relativePath = normalizeBuildPath(input.path);
  const mediaType = input.mediaType?.trim() || mediaTypeForPath(relativePath);
  if (/\r|\n/u.test(mediaType)) throw new BuildValidationError(`Invalid media type for ${relativePath}.`);
  return {
    path: `${namespace}/${relativePath}`,
    kind,
    mediaType,
    bytes: toBytes(input.contents),
    compression: input.compression ?? 'auto',
  };
}

function prepareBundle(bundle: BuildBundleInput, namespace: 'runtime' | 'scripts', kind: 'runtime' | 'script') {
  if (!bundle.files.length) throw new BuildValidationError(`${namespace} must contain at least one bundled file.`);
  const entry = normalizeBuildPath(bundle.entry);
  if (!MODULE_EXTENSION.test(entry)) {
    throw new BuildValidationError(`${namespace} entry ${JSON.stringify(entry)} must be a .js or .mjs module.`);
  }
  const files = bundle.files.map((file) => prepareInput(file, namespace, kind));
  const names = new Set(files.map((file) => file.path.slice(namespace.length + 1)));
  if (!names.has(entry)) {
    throw new BuildValidationError(`${namespace} entry ${JSON.stringify(entry)} does not exist in its bundled files.`);
  }
  return { entry: `${namespace}/${entry}`, files };
}

/**
 * Authored modules are intentionally packaged as inert artifacts until the
 * opaque behavior sandbox owns their lifecycle. Giving the files a JavaScript
 * extension or MIME type would make an accidental import enough to execute
 * author-controlled top-level code in the exported game's main realm.
 */
function prepareScriptArtifacts(bundle: BuildBundleInput, profile: BuildProfileMetadata['id']) {
  const prepared = prepareBundle(bundle, 'scripts', 'script');
  const entryFile = prepared.files.find((file) => file.path === prepared.entry);
  if (!entryFile) throw new BuildValidationError('Authored behavior entry is missing.');
  let moduleCode: string;
  try {
    moduleCode = TEXT_DECODER.decode(entryFile.bytes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new BuildValidationError(`Authored behavior entry must be valid UTF-8 JavaScript: ${reason}`);
  }
  if (bundle.contentHash !== undefined && !/^[a-f0-9]{64}$/iu.test(bundle.contentHash)) {
    throw new BuildValidationError('Authored behavior contentHash must be a SHA-256 hex digest.');
  }
  if (
    bundle.projectRevision !== undefined
    && (!Number.isSafeInteger(bundle.projectRevision) || bundle.projectRevision < 0)
  ) {
    throw new BuildValidationError('Authored behavior projectRevision must be a non-negative safe integer.');
  }
  const files = prepared.files
    .filter((file) => profile !== 'production' || !/\.map$/iu.test(file.path))
    .map((file): PreparedFile => ({
      ...file,
      path: `${file.path}${SCRIPT_ARTIFACT_SUFFIX}`,
      mediaType: 'application/octet-stream',
    }));
  return {
    entry: `${prepared.entry}${SCRIPT_ARTIFACT_SUFFIX}`,
    files,
    moduleCode,
    expectedContentHash: bundle.contentHash ?? null,
    projectRevision: bundle.projectRevision ?? 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScriptSourceCatalogAsset(value: unknown): boolean {
  if (!isRecord(value) || value.kind !== 'data' || !isRecord(value.value)) return false;
  return value.value.format === SCRIPT_SOURCE_CATALOG_FORMAT;
}

function containsScriptSourceCatalog(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (isRecord(value) && value.format === SCRIPT_SOURCE_CATALOG_FORMAT) return true;
  return Object.values(value).some((entry) => containsScriptSourceCatalog(entry, seen));
}

function prepareRuntimeProject(
  input: BuildFileInput,
  profile: BuildProfileMetadata['id'],
): { file: PreparedFile; manifest: Record<string, unknown> } {
  const file = prepareInput(input, 'project', 'project');
  let manifest: unknown;
  try {
    manifest = JSON.parse(TEXT_DECODER.decode(file.bytes));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new BuildValidationError(`Project manifest must be valid UTF-8 JSON: ${reason}`);
  }
  if (!isRecord(manifest)) throw new BuildValidationError('Project manifest must be a JSON object.');

  if (profile === 'production') {
    if (Array.isArray(manifest.assets)) {
      manifest.assets = manifest.assets.filter((asset) => !isScriptSourceCatalogAsset(asset));
    }
    // Compatibility fields from early schema-v5 prototypes are authoring-only
    // and must never make raw behavior source part of a production artifact.
    delete manifest.behaviorSources;
    delete manifest.scriptSources;
    if (containsScriptSourceCatalog(manifest)) {
      throw new BuildValidationError('Production project manifests cannot contain authored script source catalogs.');
    }
  }

  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  return {
    file: { ...file, bytes: TEXT_ENCODER.encode(serialized) },
    manifest,
  };
}

function assertUniquePaths(files: readonly PreparedFile[]): void {
  const seen = new Map<string, string>();
  for (const file of files) {
    const portableKey = file.path.toLowerCase();
    const previous = seen.get(portableKey);
    if (previous) {
      throw new BuildValidationError(
        `Build paths ${JSON.stringify(previous)} and ${JSON.stringify(file.path)} collide on case-insensitive hosts.`,
      );
    }
    seen.set(portableKey, file.path);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createIndexHtml(title: string): string {
  const safeTitle = escapeHtml(title);
  const safeCsp = escapeHtml(OFFLINE_BUILD_CSP);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta http-equiv="Content-Security-Policy" content="${safeCsp}" />
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <div id="threejs-studio-game" role="application" aria-label="${safeTitle}"></div>
  <noscript>This game requires JavaScript.</noscript>
  <script type="module" src="./bootstrap.js"></script>
</body>
</html>
`;
}

function createBootstrapModule(
  profile: BuildProfileMetadata['id'],
  runtimeEntry: string,
  projectManifest: Record<string, unknown>,
  behaviorPreview: {
    identity: { sessionId: string; revision: number; buildHash: string };
  } | null,
): string {
  const serializedContext = JSON.stringify({
    profile,
    assetBaseUrl: './assets/',
    runtimeEntryUrl: `./${runtimeEntry}`,
  });
  const serializedProject = JSON.stringify(JSON.stringify(projectManifest));
  const serializedBehaviorPreview = JSON.stringify(behaviorPreview);
  return `const paths = ${serializedContext};
const projectManifest = JSON.parse(${serializedProject});
const behaviorPreview = ${serializedBehaviorPreview};
const build = Object.freeze({
  profile: paths.profile,
  assetBaseUrl: new URL(paths.assetBaseUrl, import.meta.url).href,
  runtimeEntryUrl: new URL(paths.runtimeEntryUrl, import.meta.url).href,
  projectManifest,
});
Object.defineProperty(globalThis, '__THREEJS_STUDIO_BUILD__', {
  value: build,
  enumerable: false,
  configurable: false,
  writable: false,
});

async function mountAuthoredBehavior() {
  if (!behaviorPreview) return null;
  const iframe = document.createElement('iframe');
  iframe.title = 'Authored behavior runtime';
  iframe.name = 'offline-authored-behavior';
  iframe.hidden = true;
  iframe.setAttribute('sandbox', ${JSON.stringify(RUNTIME_PREVIEW_SANDBOX)});
  iframe.setAttribute('allow', ${JSON.stringify(RUNTIME_PREVIEW_ALLOW)});
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('data-threejs-studio-runtime-preview', '');
  iframe.src = new URL('./authored-behavior.html', import.meta.url).href;
  const loaded = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Authored behavior frame timed out.')), 5000);
    iframe.addEventListener('load', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    iframe.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Authored behavior frame failed to load.'));
    }, { once: true });
  });
  document.body.append(iframe);
  await loaded;

  const channel = new MessageChannel();
  let inboundSequence = 1;
  let outboundSequence = 1;
  let requestSequence = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Authored behavior handshake timed out.')), 5000);
    channel.port1.addEventListener('message', (event) => {
      const envelope = event.data;
      if (!envelope || envelope.sequence !== inboundSequence || envelope.sessionId !== behaviorPreview.identity.sessionId
        || envelope.revision !== behaviorPreview.identity.revision || envelope.buildHash !== behaviorPreview.identity.buildHash) return;
      inboundSequence += 1;
      const message = envelope.message;
      if (message?.type === 'runtime.ready') {
        clearTimeout(timeout);
        resolve(message.diagnostics);
        return;
      }
      if (message?.type === 'runtime.result' && typeof message.requestId === 'string') {
        const request = pending.get(message.requestId);
        if (!request) return;
        pending.delete(message.requestId);
        request.resolve(message.diagnostics);
        return;
      }
      if (message?.type === 'runtime.error') {
        const error = new Error(message.message || 'Authored behavior runtime failed.');
        if (typeof message.requestId === 'string') {
          const request = pending.get(message.requestId);
          pending.delete(message.requestId);
          request?.reject(error);
        }
        if (message.fatal) {
          clearTimeout(timeout);
          reject(error);
        }
      }
    });
    channel.port1.start();
  });
  iframe.contentWindow.postMessage({
    transport: ${JSON.stringify(RUNTIME_PREVIEW_TRANSPORT)},
    transportVersion: ${RUNTIME_PREVIEW_TRANSPORT_VERSION},
    type: 'runtime.handshake',
    handshakeId: 'offline-authored-behavior',
    ...behaviorPreview.identity,
  }, '*', [channel.port2]);
  await ready;

  const command = (action) => {
    const requestId = 'offline-behavior-' + (++requestSequence);
    const message = {
      protocol: ${JSON.stringify(RUNTIME_IFRAME_PROTOCOL)},
      protocolVersion: ${RUNTIME_IFRAME_PROTOCOL_VERSION},
      ...behaviorPreview.identity,
      type: 'runtime.command',
      requestId,
      action,
    };
    const result = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    channel.port1.postMessage({
      transport: ${JSON.stringify(RUNTIME_PREVIEW_TRANSPORT)},
      transportVersion: ${RUNTIME_PREVIEW_TRANSPORT_VERSION},
      sequence: outboundSequence++,
      ...behaviorPreview.identity,
      message,
    });
    return result;
  };
  const diagnostics = await command('start');
  const controller = { iframe, diagnostics, command };
  Object.defineProperty(globalThis, '__THREEJS_STUDIO_AUTHORED_BEHAVIOR__', {
    value: controller,
    enumerable: false,
    configurable: true,
  });
  addEventListener('pagehide', () => {
    void command('dispose').catch(() => undefined);
    channel.port1.close();
    iframe.remove();
    delete globalThis.__THREEJS_STUDIO_AUTHORED_BEHAVIOR__;
  }, { once: true });
  return controller;
}

try {
  await mountAuthoredBehavior();
  const runtimeModule = await import(build.runtimeEntryUrl);
  const boot = runtimeModule.boot ?? runtimeModule.default;
  if (typeof boot !== 'function') {
    throw new TypeError('The bundled runtime entry must export a boot function or default function.');
  }
  await boot(build);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const host = document.getElementById('threejs-studio-game') ?? document.body;
  host.textContent = 'Game failed to start: ' + message;
  host.setAttribute('data-build-error', 'true');
  console.error(error);
}
`;
}

const DEFAULT_STYLES = `*{box-sizing:border-box}html,body,#threejs-studio-game{width:100%;height:100%;margin:0;overflow:hidden}body{background:#090d12;color:#eef5f4;font-family:system-ui,sans-serif}canvas{display:block;width:100%;height:100%;touch-action:none}[data-build-error="true"]{display:grid;place-items:center;padding:2rem;text-align:center;color:#ffb4ab}`;

function generatedFile(path: string, contents: string, mediaType: string): PreparedFile {
  return { path, kind: 'generated', mediaType, bytes: TEXT_ENCODER.encode(contents), compression: 'deflate' };
}

function compressionLevelFor(file: PreparedFile, profile: BuildProfileMetadata): 0 | 6 | 9 {
  if (file.compression === 'store') return 0;
  if (file.compression === 'deflate') return profile.offlineZip.compressionLevel;
  return STORED_EXTENSIONS.test(file.path) ? 0 : profile.offlineZip.compressionLevel;
}

function zipDeterministically(
  files: readonly PreparedFile[],
  profile: BuildProfileMetadata,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfCancelled(signal);
  const zippable: AsyncZippable = {};
  for (const file of [...files].sort(comparePaths)) {
    const options: ZipOptions = {
      level: compressionLevelFor(file, profile),
      mtime: FIXED_ZIP_MTIME,
      os: 3,
      attrs: 0o644 << 16,
    };
    zippable[file.path] = [file.bytes, options];
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let terminate: (() => void) | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => {
      terminate?.();
      finish(() => reject(new BuildCancelledError(signal?.reason)));
    };
    terminate = zip(zippable, { level: profile.offlineZip.compressionLevel, mtime: FIXED_ZIP_MTIME }, (error, data) => {
      if (error) finish(() => reject(error));
      else finish(() => resolve(new Uint8Array(data)));
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function slugifyProjectName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return slug || 'threejs-studio-game';
}

export async function buildOfflineZip(request: BuildRequest): Promise<BuildResult> {
  throwIfCancelled(request.signal);
  emitProgress(request, { stage: 'validating', ratio: 0, completed: 0, total: 1 });
  const profile = BUILD_PROFILES[request.profile];
  if (!profile) throw new BuildValidationError(`Unknown build profile ${JSON.stringify(request.profile)}.`);
  if (!request.projectName.trim()) throw new BuildValidationError('projectName cannot be empty.');

  const runtime = prepareBundle(request.runtime, 'runtime', 'runtime');
  const scripts = request.scripts ? prepareScriptArtifacts(request.scripts, request.profile) : null;
  const preparedProject = prepareRuntimeProject(request.project, request.profile);
  let behaviorPreview: {
    identity: { sessionId: string; revision: number; buildHash: string };
  } | null = null;
  let behaviorPreviewDocument: string | null = null;
  if (scripts) {
    const contentHash = await sha256Hex(TEXT_ENCODER.encode(scripts.moduleCode));
    if (scripts.expectedContentHash && scripts.expectedContentHash.toLowerCase() !== contentHash) {
      throw new BuildValidationError('Authored behavior bytes do not match their compiled contentHash.');
    }
    const identity = {
      sessionId: 'offline-authored-behavior',
      revision: scripts.projectRevision,
      buildHash: contentHash,
    };
    const runtimeSource = createAuthoredBehaviorPreviewSource({
      moduleCode: scripts.moduleCode,
      contentHash,
      projectRevision: scripts.projectRevision,
    }, createBehaviorPreviewSnapshot(preparedProject.manifest));
    behaviorPreview = { identity };
    behaviorPreviewDocument = createRuntimePreviewDocument(runtimeSource);
  }
  const project = preparedProject.file;
  const assets = (request.assets ?? []).map((asset) => prepareInput(asset, 'assets', 'asset'));
  const title = request.title?.trim() || request.projectName.trim();
  const filename = request.filename
    ? normalizeBuildFilename(request.filename)
    : `${slugifyProjectName(request.projectName)}-${request.profile}.zip`;

  const generated = [
    generatedFile('index.html', createIndexHtml(title), 'text/html; charset=utf-8'),
    ...(behaviorPreviewDocument
      ? [generatedFile('authored-behavior.html', behaviorPreviewDocument, 'text/html; charset=utf-8')]
      : []),
    generatedFile(
      'bootstrap.js',
      createBootstrapModule(request.profile, runtime.entry, preparedProject.manifest, behaviorPreview),
      'text/javascript; charset=utf-8',
    ),
    generatedFile('styles.css', DEFAULT_STYLES, 'text/css; charset=utf-8'),
  ];
  const payloadFiles = [...generated, ...runtime.files, ...(scripts?.files ?? []), project, ...assets]
    .sort(comparePaths);
  assertUniquePaths(payloadFiles);
  emitProgress(request, { stage: 'assembling', ratio: 0.1, completed: payloadFiles.length, total: payloadFiles.length });

  const manifestFiles: BuildManifestFile[] = [];
  for (let index = 0; index < payloadFiles.length; index += 1) {
    const file = payloadFiles[index];
    const sha256 = await sha256Hex(file.bytes);
    manifestFiles.push({
      path: file.path,
      kind: file.kind,
      mediaType: file.mediaType,
      bytes: file.bytes.byteLength,
      sha256,
    });
    emitProgress(request, {
      stage: 'hashing',
      ratio: 0.1 + 0.7 * ((index + 1) / payloadFiles.length),
      completed: index + 1,
      total: payloadFiles.length,
      path: file.path,
    });
  }

  const manifest: BuildManifest = {
    format: 'threejs-studio-offline-build',
    formatVersion: 1,
    profile: request.profile,
    profileMetadata: profile,
    entrypoint: 'index.html',
    bootstrap: 'bootstrap.js',
    project: project.path,
    runtimeEntry: runtime.entry,
    scriptEntry: scripts?.entry ?? null,
    assetBase: 'assets/',
    offline: true,
    networkDependencies: [],
    contentSecurityPolicy: OFFLINE_BUILD_CSP,
    security: {
      networkPolicy: 'deny',
      authoredScriptExecution: scripts ? 'opaque-sandbox' : 'disabled-pending-opaque-sandbox',
      projectAuthoringSource: request.profile === 'production' ? 'omitted' : 'included',
    },
    hashAlgorithm: 'SHA-256',
    files: manifestFiles,
  };
  const manifestBytes = TEXT_ENCODER.encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const manifestSha256 = await sha256Hex(manifestBytes);
  const allFiles = [
    ...payloadFiles,
    {
      path: 'manifest.json',
      kind: 'generated' as const,
      mediaType: 'application/json; charset=utf-8',
      bytes: manifestBytes,
      compression: 'deflate' as const,
    },
  ].sort(comparePaths);

  emitProgress(request, { stage: 'compressing', ratio: 0.85, completed: 0, total: allFiles.length });
  const archive = await zipDeterministically(allFiles, profile, request.signal);
  throwIfCancelled(request.signal);
  const archiveSha256 = await sha256Hex(archive);
  emitProgress(request, { stage: 'complete', ratio: 1, completed: allFiles.length, total: allFiles.length });

  return {
    profile: request.profile,
    format: 'offline-zip',
    filename,
    archive,
    byteLength: archive.byteLength,
    archiveSha256,
    manifestSha256,
    manifest,
  };
}
