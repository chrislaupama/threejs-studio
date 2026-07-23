import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import type { ProjectDocumentV5 } from '../editor/types';
import { createWorkerScriptCompiler } from '../scripting/compiler';
import { createVirtualProjectSnapshot } from '../scripting/virtualFileSystem';
import type { BuildBundleInput, BuildProfile } from './types';

export interface CompiledProjectScripts {
  bundle: BuildBundleInput | null;
  diagnostics: string[];
  contentHash: string | null;
  moduleCode: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read the versioned JSON source catalog used by script assets. */
export function getProjectScriptSources(project: ProjectDocumentV5): Record<string, string> {
  const result: Record<string, string> = {};
  for (const asset of project.assets) {
    if (asset.kind !== 'data' || !isRecord(asset.value)) continue;
    if (asset.value.format !== 'threejs-studio.source-catalog.v1' || !isRecord(asset.value.files)) continue;
    for (const [path, source] of Object.entries(asset.value.files)) {
      if (typeof source === 'string') result[path] = source;
    }
  }
  return result;
}

export async function compileProjectScriptsForBuild(
  project: ProjectDocumentV5,
  revision: number,
  profile: BuildProfile,
): Promise<CompiledProjectScripts> {
  const sources = getProjectScriptSources(project);
  const entries = Object.entries(sources);
  if (!entries.length) return {
    bundle: null,
    diagnostics: [],
    contentHash: null,
    moduleCode: null,
  };

  const declaredEntry = project.assets.find((asset) => asset.kind === 'script')?.entryPoint;
  const entryPath = declaredEntry && sources[declaredEntry]
    ? declaredEntry
    : entries.find(([path]) => /(?:^|\/)index\.(?:ts|tsx|js|jsx)$/u.test(path))?.[0] ?? entries[0]![0];
  const compiler = createWorkerScriptCompiler(esbuildWasmUrl);
  const result = await compiler.compile({
    requestId: `build.${project.id}.${revision}`.replace(/[^A-Za-z0-9._:-]/gu, '-').slice(0, 128),
    projectRevision: revision,
    entryPath,
    snapshot: createVirtualProjectSnapshot(
      entries.map(([path, contents]) => ({ path, contents })),
      revision,
    ),
    mode: profile === 'production' ? 'production' : 'development',
  });
  const diagnostics = result.diagnostics.map((diagnostic) => {
    const location = diagnostic.filePath
      ? `${diagnostic.filePath}${diagnostic.line ? `:${diagnostic.line}:${diagnostic.column ?? 1}` : ''}: `
      : '';
    return `${location}${diagnostic.code} ${diagnostic.message}`;
  });
  if (!result.ok) return {
    bundle: null,
    diagnostics,
    contentHash: null,
    moduleCode: null,
  };

  const files = [{
    path: 'behaviors.js',
    contents: result.javascript,
    mediaType: 'text/javascript; charset=utf-8',
    compression: 'deflate' as const,
  }];
  if (result.sourceMap && profile !== 'production') {
    files.push({
      path: 'behaviors.js.map',
      contents: result.sourceMap,
      mediaType: 'application/json; charset=utf-8',
      compression: 'deflate' as const,
    });
  }
  return {
    bundle: {
      entry: 'behaviors.js',
      files,
      contentHash: result.contentHash,
      projectRevision: revision,
    },
    diagnostics,
    contentHash: result.contentHash,
    moduleCode: result.javascript,
  };
}
