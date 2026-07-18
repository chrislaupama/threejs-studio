import { normalizeVirtualPath } from '../scripting/virtualFileSystem';
import { validateProjectDocumentV5 } from './projectV5';
import type {
  DataAssetRecordV5,
  ProjectDocumentV5,
  ScriptAssetRecordV5,
} from './types';

export const SCRIPT_SOURCE_CATALOG_FORMAT = 'threejs-studio.source-catalog.v1';
export const DEFAULT_SCRIPT_SOURCE_CATALOG_ID = 'asset.sources.project';

export interface ScriptSourceRecord {
  assetId: string;
  path: string;
  language: ScriptAssetRecordV5['language'];
  source: string;
  revision: number;
  updatedAt: string;
}

export type GameAuthoringOperationResult =
  | { ok: true; project: ProjectDocumentV5; changed: boolean; affectedAssetIds: string[]; warnings: string[] }
  | { ok: false; project: ProjectDocumentV5; changed: false; affectedAssetIds: []; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceCatalog(project: ProjectDocumentV5): DataAssetRecordV5 | undefined {
  return project.assets.find((asset): asset is DataAssetRecordV5 =>
    asset.kind === 'data' && isRecord(asset.value) && asset.value.format === SCRIPT_SOURCE_CATALOG_FORMAT,
  );
}

function sourceFiles(catalog: DataAssetRecordV5 | undefined): Record<string, string> {
  if (!catalog || !isRecord(catalog.value) || !isRecord(catalog.value.files)) return {};
  return Object.fromEntries(Object.entries(catalog.value.files).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function languageForPath(path: string): ScriptAssetRecordV5['language'] {
  return path.endsWith('.js') || path.endsWith('.jsx') ? 'javascript' : 'typescript';
}

export function listProjectScripts(project: ProjectDocumentV5): ScriptSourceRecord[] {
  const files = sourceFiles(sourceCatalog(project));
  return project.assets
    .filter((asset): asset is ScriptAssetRecordV5 => asset.kind === 'script')
    .flatMap((asset) => {
      const source = files[asset.entryPoint];
      return source === undefined ? [] : [{
        assetId: asset.id,
        path: asset.entryPoint,
        language: asset.language,
        source,
        revision: asset.revision,
        updatedAt: asset.updatedAt,
      }];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function fail(project: ProjectDocumentV5, ...errors: string[]): GameAuthoringOperationResult {
  return { ok: false, project: structuredClone(project), changed: false, affectedAssetIds: [], errors };
}

export function upsertProjectScript(
  project: ProjectDocumentV5,
  input: {
    assetId: string;
    path: string;
    source: string;
    timestamp: string;
    catalogAssetId?: string;
  },
): GameAuthoringOperationResult {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(input.assetId)) return fail(project, 'assetId must be a stable identifier.');
  if (!input.timestamp || Number.isNaN(Date.parse(input.timestamp))) return fail(project, 'timestamp must be an ISO-compatible date.');
  let path: string;
  try {
    path = normalizeVirtualPath(input.path).slice(1);
  } catch (error) {
    return fail(project, error instanceof Error ? error.message : 'Script path is invalid.');
  }
  const encoded = new TextEncoder().encode(input.source);
  if (encoded.byteLength > 2 * 1024 * 1024) return fail(project, 'Script source exceeds the 2 MB per-file limit.');

  const next = structuredClone(project);
  const existing = next.assets.find((asset): asset is ScriptAssetRecordV5 => asset.kind === 'script' && asset.id === input.assetId);
  const conflicting = next.assets.find((asset) => asset.id === input.assetId && asset.kind !== 'script');
  if (conflicting) return fail(project, `Asset id "${input.assetId}" belongs to a ${conflicting.kind} asset.`);
  const catalog = sourceCatalog(next);
  const files = sourceFiles(catalog);
  files[path] = input.source;
  if (existing && existing.entryPoint !== path) delete files[existing.entryPoint];

  const script: ScriptAssetRecordV5 = {
    assetVersion: 1,
    id: input.assetId,
    kind: 'script',
    name: path.split('/').at(-1) ?? path,
    revision: existing ? existing.revision + 1 : 1,
    createdAt: existing?.createdAt ?? input.timestamp,
    updatedAt: input.timestamp,
    tags: structuredClone(existing?.tags ?? ['behavior']),
    source: {
      filename: path,
      mimeType: languageForPath(path) === 'typescript' ? 'text/typescript' : 'text/javascript',
      byteLength: encoded.byteLength,
    },
    language: languageForPath(path),
    runtime: 'worker',
    entryPoint: path,
  };
  if (existing) next.assets[next.assets.indexOf(existing)] = script;
  else next.assets.push(script);

  const nextCatalog: DataAssetRecordV5 = {
    assetVersion: 1,
    id: catalog?.id ?? input.catalogAssetId ?? DEFAULT_SCRIPT_SOURCE_CATALOG_ID,
    kind: 'data',
    name: catalog?.name ?? 'Project Script Sources',
    revision: catalog ? catalog.revision + 1 : 1,
    createdAt: catalog?.createdAt ?? input.timestamp,
    updatedAt: input.timestamp,
    tags: structuredClone(catalog?.tags ?? ['source', 'typescript']),
    value: { format: SCRIPT_SOURCE_CATALOG_FORMAT, version: 1, files },
  };
  if (catalog) next.assets[next.assets.indexOf(catalog)] = nextCatalog;
  else next.assets.push(nextCatalog);
  next.updatedAt = input.timestamp;

  const validation = validateProjectDocumentV5(next);
  if (!validation.ok) return fail(project, ...validation.errors);
  return {
    ok: true,
    project: validation.project,
    changed: true,
    affectedAssetIds: [script.id, nextCatalog.id],
    warnings: validation.warnings,
  };
}

export function deleteProjectScript(
  project: ProjectDocumentV5,
  assetId: string,
  timestamp: string,
): GameAuthoringOperationResult {
  const script = project.assets.find((asset): asset is ScriptAssetRecordV5 => asset.kind === 'script' && asset.id === assetId);
  if (!script) return fail(project, `Script asset "${assetId}" does not exist.`);
  const next = structuredClone(project);
  next.assets = next.assets.filter((asset) => asset.id !== assetId);
  const catalog = sourceCatalog(next);
  if (catalog) {
    const files = sourceFiles(catalog);
    delete files[script.entryPoint];
    catalog.value = { format: SCRIPT_SOURCE_CATALOG_FORMAT, version: 1, files };
    catalog.revision += 1;
    catalog.updatedAt = timestamp;
  }
  next.updatedAt = timestamp;
  const validation = validateProjectDocumentV5(next);
  if (!validation.ok) return fail(project, ...validation.errors);
  return { ok: true, project: validation.project, changed: true, affectedAssetIds: [assetId, ...(catalog ? [catalog.id] : [])], warnings: validation.warnings };
}
