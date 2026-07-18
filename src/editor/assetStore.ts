import type { StoredModelSource } from './modelAssets';
import type { ProjectDocument, ProjectDocumentV5 } from './types';

export const ASSET_DB_NAME = 'threejs-studio-assets';
export const LEGACY_ASSET_DB_NAME = 'threejs-game-studio-assets';
export const ASSET_STORE_NAME = 'modelSources';
const ASSET_DB_VERSION = 1;
export const PORTABLE_PROJECT_FORMAT = 'threejs-studio-project';
export const LEGACY_PORTABLE_PROJECT_FORMAT = 'threejs-game-studio-project';

interface StoredModelSourceRecord extends StoredModelSource {
  key: string;
  projectId: string;
  assetId: string;
  revision: number;
}

interface PortableAssetSource {
  assetId: string;
  revision: number;
  fileName: string;
  mimeType: string;
  byteLength: number;
  base64: string;
}

export interface PortableProjectBundle {
  format: typeof PORTABLE_PROJECT_FORMAT;
  bundleVersion: 1;
  project: ProjectDocument;
  assetSources: PortableAssetSource[];
}

export interface PortableGameProjectBundle {
  format: typeof PORTABLE_PROJECT_FORMAT;
  bundleVersion: 2;
  project: ProjectDocumentV5;
  assetSources: PortableAssetSource[];
}

const databasePromises = new Map<string, Promise<IDBDatabase>>();

export const assetSourceKey = (projectId: string, assetId: string, revision: number) =>
  `${projectId}::${assetId}::${revision}`;

function openAssetDatabase(databaseName = ASSET_DB_NAME): Promise<IDBDatabase> {
  const existing = databasePromises.get(databaseName);
  if (existing) return existing;
  const databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, ASSET_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ASSET_STORE_NAME)) {
        const store = database.createObjectStore(ASSET_STORE_NAME, { keyPath: 'key' });
        store.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    request.onerror = () => {
      databasePromises.delete(databaseName);
      reject(request.error ?? new Error('Could not open the local model store.'));
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromises.delete(databaseName);
      };
      resolve(database);
    };
    request.onblocked = () => {
      databasePromises.delete(databaseName);
      reject(new Error('The local model store is blocked by another open studio tab.'));
    };
  });
  databasePromises.set(databaseName, databasePromise);
  return databasePromise;
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('The local model operation was cancelled.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('The local model operation failed.'));
  });
}

export async function putModelAssetSource(
  projectId: string,
  assetId: string,
  revision: number,
  source: StoredModelSource,
): Promise<void> {
  const database = await openAssetDatabase();
  const transaction = database.transaction(ASSET_STORE_NAME, 'readwrite');
  const record: StoredModelSourceRecord = {
    key: assetSourceKey(projectId, assetId, revision),
    projectId,
    assetId,
    revision,
    fileName: source.fileName,
    mimeType: source.mimeType,
    byteLength: source.byteLength,
    bytes: source.bytes.slice(0),
  };
  transaction.objectStore(ASSET_STORE_NAME).put(record);
  await waitForTransaction(transaction);
}

export async function getModelAssetSource(
  projectId: string,
  assetId: string,
  revision: number,
): Promise<StoredModelSource | null> {
  const key = assetSourceKey(projectId, assetId, revision);
  const readRecord = async (databaseName: string) => {
    const database = await openAssetDatabase(databaseName);
    const transaction = database.transaction(ASSET_STORE_NAME, 'readonly');
    const completion = waitForTransaction(transaction);
    const request = transaction.objectStore(ASSET_STORE_NAME).get(key);
    const record = await new Promise<StoredModelSourceRecord | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredModelSourceRecord | undefined);
      request.onerror = () => reject(request.error ?? new Error('Could not read the local model file.'));
    });
    await completion;
    return record;
  };
  const canonicalRecord = await readRecord(ASSET_DB_NAME);
  const record = canonicalRecord ?? await readRecord(LEGACY_ASSET_DB_NAME);
  if (record && !canonicalRecord) {
    try {
      await putModelAssetSource(projectId, assetId, revision, record);
      const legacyDatabase = await openAssetDatabase(LEGACY_ASSET_DB_NAME);
      const legacyTransaction = legacyDatabase.transaction(ASSET_STORE_NAME, 'readwrite');
      legacyTransaction.objectStore(ASSET_STORE_NAME).delete(key);
      await waitForTransaction(legacyTransaction);
    } catch (error) {
      // A readable legacy source remains usable even when quota or browser
      // policy prevents the best-effort copy into the canonical database.
      console.warn('Could not migrate a legacy ThreeJS Studio model source yet.', error);
    }
  }
  return record
    ? {
        fileName: record.fileName,
        mimeType: record.mimeType,
        byteLength: record.byteLength,
        bytes: record.bytes.slice(0),
      }
    : null;
}

export async function deleteModelAssetSource(
  projectId: string,
  assetId: string,
  revision: number,
): Promise<void> {
  const key = assetSourceKey(projectId, assetId, revision);
  await Promise.all([ASSET_DB_NAME, LEGACY_ASSET_DB_NAME].map(async (databaseName) => {
    const database = await openAssetDatabase(databaseName);
    const transaction = database.transaction(ASSET_STORE_NAME, 'readwrite');
    transaction.objectStore(ASSET_STORE_NAME).delete(key);
    await waitForTransaction(transaction);
  }));
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, Math.min(offset + chunkSize, data.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function sourceToDataUrl(source: StoredModelSource): string {
  const mimeType = source.mimeType || (source.fileName.toLowerCase().endsWith('.gltf') ? 'model/gltf+json' : 'model/gltf-binary');
  return `data:${mimeType};base64,${bytesToBase64(source.bytes)}`;
}

export async function createPortableProjectBundle(project: ProjectDocument): Promise<{
  bundle: PortableProjectBundle;
  missingAssetIds: string[];
}> {
  const assetSources: PortableAssetSource[] = [];
  const missingAssetIds: string[] = [];
  for (const asset of project.assets) {
    const source = await getModelAssetSource(project.id, asset.id, asset.revision);
    if (!source) {
      missingAssetIds.push(asset.id);
      continue;
    }
    assetSources.push({
      assetId: asset.id,
      revision: asset.revision,
      fileName: source.fileName,
      mimeType: source.mimeType,
      byteLength: source.byteLength,
      base64: bytesToBase64(source.bytes),
    });
  }
  return {
    bundle: {
      format: PORTABLE_PROJECT_FORMAT,
      bundleVersion: 1,
      project,
      assetSources,
    },
    missingAssetIds,
  };
}

export async function createPortableGameProjectBundle(project: ProjectDocumentV5): Promise<{
  bundle: PortableGameProjectBundle;
  missingAssetIds: string[];
}> {
  const assetSources: PortableAssetSource[] = [];
  const missingAssetIds: string[] = [];
  for (const asset of project.assets) {
    if (asset.kind !== 'model') continue;
    const source = await getModelAssetSource(project.id, asset.id, asset.revision);
    if (!source) {
      missingAssetIds.push(asset.id);
      continue;
    }
    assetSources.push({
      assetId: asset.id,
      revision: asset.revision,
      fileName: source.fileName,
      mimeType: source.mimeType,
      byteLength: source.byteLength,
      base64: bytesToBase64(source.bytes),
    });
  }
  return {
    bundle: {
      format: PORTABLE_PROJECT_FORMAT,
      bundleVersion: 2,
      project,
      assetSources,
    },
    missingAssetIds,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readPortableProjectBundle(value: unknown): {
  project: unknown;
  sources: Array<{ assetId: string; revision: number; source: StoredModelSource }>;
} | null {
  if (
    !isRecord(value) ||
    (value.format !== PORTABLE_PROJECT_FORMAT && value.format !== LEGACY_PORTABLE_PROJECT_FORMAT) ||
    value.bundleVersion !== 1
  ) return null;
  if (!Array.isArray(value.assetSources)) throw new Error('Project package assetSources must be an array.');
  const sources = value.assetSources.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Project package assetSources[${index}] must be an object.`);
    if (typeof entry.assetId !== 'string' || !entry.assetId) throw new Error(`Project package assetSources[${index}].assetId is invalid.`);
    if (typeof entry.revision !== 'number' || !Number.isInteger(entry.revision) || entry.revision < 1) throw new Error(`Project package assetSources[${index}].revision is invalid.`);
    if (typeof entry.fileName !== 'string' || !entry.fileName) throw new Error(`Project package assetSources[${index}].fileName is invalid.`);
    if (typeof entry.mimeType !== 'string') throw new Error(`Project package assetSources[${index}].mimeType is invalid.`);
    if (typeof entry.base64 !== 'string') throw new Error(`Project package assetSources[${index}].base64 is invalid.`);
    const bytes = base64ToBytes(entry.base64);
    if (typeof entry.byteLength !== 'number' || entry.byteLength !== bytes.byteLength) {
      throw new Error(`Project package assetSources[${index}].byteLength does not match its data.`);
    }
    return {
      assetId: entry.assetId,
      revision: entry.revision,
      source: {
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        byteLength: bytes.byteLength,
        bytes,
      },
    };
  });
  return { project: value.project, sources };
}

export function readPortableGameProjectBundle(value: unknown): {
  project: unknown;
  sources: Array<{ assetId: string; revision: number; source: StoredModelSource }>;
} | null {
  if (
    !isRecord(value) ||
    value.format !== PORTABLE_PROJECT_FORMAT ||
    value.bundleVersion !== 2
  ) return null;
  if (!Array.isArray(value.assetSources)) throw new Error('Game project package assetSources must be an array.');
  const sources = value.assetSources.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Game project package assetSources[${index}] must be an object.`);
    if (typeof entry.assetId !== 'string' || !entry.assetId) throw new Error(`Game project package assetSources[${index}].assetId is invalid.`);
    if (typeof entry.revision !== 'number' || !Number.isInteger(entry.revision) || entry.revision < 1) throw new Error(`Game project package assetSources[${index}].revision is invalid.`);
    if (typeof entry.fileName !== 'string' || !entry.fileName) throw new Error(`Game project package assetSources[${index}].fileName is invalid.`);
    if (typeof entry.mimeType !== 'string') throw new Error(`Game project package assetSources[${index}].mimeType is invalid.`);
    if (typeof entry.base64 !== 'string') throw new Error(`Game project package assetSources[${index}].base64 is invalid.`);
    const bytes = base64ToBytes(entry.base64);
    if (typeof entry.byteLength !== 'number' || entry.byteLength !== bytes.byteLength) {
      throw new Error(`Game project package assetSources[${index}].byteLength does not match its data.`);
    }
    return {
      assetId: entry.assetId,
      revision: entry.revision,
      source: {
        fileName: entry.fileName,
        mimeType: entry.mimeType,
        byteLength: bytes.byteLength,
        bytes,
      },
    };
  });
  return { project: value.project, sources };
}
