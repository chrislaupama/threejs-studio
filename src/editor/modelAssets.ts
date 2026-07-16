import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { ModelAssetDiagnostics, Vec3 } from './types';

const MAX_MODEL_BYTES = 100 * 1024 * 1024;
const LARGE_MODEL_BYTES = 20 * 1024 * 1024;
const HIGH_TRIANGLE_COUNT = 300_000;
const HIGH_MATERIAL_COUNT = 64;
const HIGH_TEXTURE_COUNT = 32;
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;

type ModelImportErrorCode =
  | 'unsupported-file'
  | 'too-large'
  | 'external-resources'
  | 'unsupported-compression'
  | 'invalid-model';

type SourceKind = 'glb' | 'gltf';
type JsonRecord = Record<string, unknown>;

export class ModelImportError extends Error {
  readonly code: ModelImportErrorCode;

  constructor(code: ModelImportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelImportError';
    this.code = code;
  }
}

export interface StoredModelSource {
  fileName: string;
  mimeType: string;
  byteLength: number;
  bytes: ArrayBuffer;
}

export function formatBytes(byteLength: number): string {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(byteLength) / Math.log(1024)), units.length - 1);
  const value = byteLength / 1024 ** unitIndex;
  const precision = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${Number(value.toFixed(precision))} ${units[unitIndex]}`;
}

export function formatTriangles(triangles: number): string {
  if (!Number.isFinite(triangles) || triangles <= 0) return '0';
  if (triangles < 1_000) return Math.round(triangles).toString();
  if (triangles < 1_000_000) {
    const value = triangles / 1_000;
    return `${Number(value.toFixed(value >= 10 ? 0 : 1))}K`;
  }
  const value = triangles / 1_000_000;
  return `${Number(value.toFixed(value >= 10 ? 0 : 1))}M`;
}

function extensionOf(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

function normalizedMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0].trim().toLowerCase();
}

function kindFromMetadata(fileName: string, mimeType: string): SourceKind | null {
  const extension = extensionOf(fileName);
  if (extension === '.glb') return 'glb';
  if (extension === '.gltf') return 'gltf';

  const normalizedMime = normalizedMimeType(mimeType);
  if (normalizedMime === 'model/gltf-binary') return 'glb';
  if (normalizedMime === 'model/gltf+json') return 'gltf';
  return null;
}

function hasGlbMagic(bytes: ArrayBuffer): boolean {
  return bytes.byteLength >= 4 && new DataView(bytes).getUint32(0, true) === GLB_MAGIC;
}

function identifySourceKind(source: StoredModelSource): SourceKind {
  const declaredKind = kindFromMetadata(source.fileName, source.mimeType);
  if (declaredKind === 'glb') {
    if (!hasGlbMagic(source.bytes)) {
      throw new ModelImportError(
        'invalid-model',
        'This file is named as a GLB, but its binary header is missing. Export it again as a glTF 2.0 GLB.',
      );
    }
    return 'glb';
  }
  if (declaredKind === 'gltf') {
    if (hasGlbMagic(source.bytes)) {
      throw new ModelImportError(
        'invalid-model',
        'This file contains GLB data but has a .gltf name. Rename it to .glb or export it again.',
      );
    }
    return 'gltf';
  }
  if (hasGlbMagic(source.bytes)) return 'glb';
  throw new ModelImportError(
    'unsupported-file',
    'Choose a .glb or .gltf file. Other 3D formats need to be converted to glTF 2.0 first.',
  );
}

function validateSourceSize(source: StoredModelSource): void {
  if (!Number.isFinite(source.byteLength) || source.byteLength !== source.bytes.byteLength) {
    throw new ModelImportError('invalid-model', 'The model file size does not match its stored data. Import the original file again.');
  }
  if (source.byteLength === 0) {
    throw new ModelImportError('invalid-model', 'The selected model file is empty.');
  }
  if (source.byteLength > MAX_MODEL_BYTES) {
    throw new ModelImportError(
      'too-large',
      `This model is ${formatBytes(source.byteLength)}. Import a model smaller than ${formatBytes(MAX_MODEL_BYTES)}.`,
    );
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordsAt(document: JsonRecord, key: string): JsonRecord[] {
  const value = document[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function decodeJson(bytes: ArrayBuffer, context: string): JsonRecord {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\u0000+$/u, '').trim();
  } catch (error) {
    throw new ModelImportError('invalid-model', `${context} does not contain valid UTF-8 JSON.`, { cause: error });
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) throw new Error('The document root is not an object.');
    return parsed;
  } catch (error) {
    throw new ModelImportError('invalid-model', `${context} contains invalid glTF JSON.`, { cause: error });
  }
}

function extractGlbJson(bytes: ArrayBuffer): JsonRecord {
  if (bytes.byteLength < 20) {
    throw new ModelImportError('invalid-model', 'The GLB header is incomplete. Export the model again as glTF 2.0.');
  }

  const view = new DataView(bytes);
  const version = view.getUint32(4, true);
  const declaredLength = view.getUint32(8, true);
  if (version !== 2) {
    throw new ModelImportError('invalid-model', `GLB version ${version} is not supported. Export the model as glTF 2.0.`);
  }
  if (declaredLength !== bytes.byteLength) {
    throw new ModelImportError('invalid-model', 'The GLB length header does not match the file. The download may be incomplete.');
  }

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > bytes.byteLength) {
      throw new ModelImportError('invalid-model', 'A GLB data chunk extends past the end of the file.');
    }
    if (chunkType === GLB_JSON_CHUNK) return decodeJson(bytes.slice(chunkStart, chunkEnd), 'The GLB');
    offset = chunkEnd;
  }

  throw new ModelImportError('invalid-model', 'The GLB does not contain a glTF JSON scene description.');
}

function parseSourceDocument(source: StoredModelSource, kind: SourceKind): JsonRecord {
  return kind === 'glb' ? extractGlbJson(source.bytes) : decodeJson(source.bytes, 'The .gltf file');
}

function hasExtension(value: unknown, extensionName: string): boolean {
  const pending: unknown[] = [value];
  const visited = new Set<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }

    const record = current as JsonRecord;
    if (Array.isArray(record.extensionsUsed) && record.extensionsUsed.includes(extensionName)) return true;
    if (Array.isArray(record.extensionsRequired) && record.extensionsRequired.includes(extensionName)) return true;
    if (isRecord(record.extensions) && Object.hasOwn(record.extensions, extensionName)) return true;
    pending.push(...Object.values(record));
  }
  return false;
}

function isDataUri(value: string): boolean {
  return value.trimStart().toLowerCase().startsWith('data:');
}

function validateSelfContainedDocument(document: JsonRecord, kind: SourceKind): void {
  const asset = isRecord(document.asset) ? document.asset : null;
  if (typeof asset?.version !== 'string' || !/^2(?:\.|$)/u.test(asset.version)) {
    throw new ModelImportError('invalid-model', 'Only glTF 2.0 models are supported. Export this model again using glTF 2.0.');
  }

  const compressionExtensions: Array<{ name: string; label: string }> = [
    { name: 'KHR_draco_mesh_compression', label: 'Draco mesh compression' },
    { name: 'EXT_meshopt_compression', label: 'Meshopt compression' },
    { name: 'KHR_texture_basisu', label: 'KTX2/Basis texture compression' },
  ];
  for (const extension of compressionExtensions) {
    if (hasExtension(document, extension.name)) {
      throw new ModelImportError(
        'unsupported-compression',
        `${extension.label} is not supported yet. Export a GLB without that compression and import it again.`,
      );
    }
  }

  for (const buffer of recordsAt(document, 'buffers')) {
    if (typeof buffer.uri === 'string' && !isDataUri(buffer.uri)) {
      throw new ModelImportError(
        'external-resources',
        'This model references an external buffer. Export a single self-contained GLB, or embed every buffer as a data URI.',
      );
    }
    if (kind === 'gltf' && typeof buffer.uri !== 'string') {
      throw new ModelImportError(
        'external-resources',
        'This .gltf file has a separate binary buffer. Export a single self-contained GLB, or embed the buffer as a data URI.',
      );
    }
  }

  for (const image of recordsAt(document, 'images')) {
    const mimeType = typeof image.mimeType === 'string' ? image.mimeType.toLowerCase() : '';
    const uri = typeof image.uri === 'string' ? image.uri : null;
    if (mimeType === 'image/ktx2' || uri?.trimStart().toLowerCase().startsWith('data:image/ktx2')) {
      throw new ModelImportError(
        'unsupported-compression',
        'KTX2 textures are not supported yet. Export the model with PNG, JPEG, or WebP textures.',
      );
    }
    if (uri !== null && !isDataUri(uri)) {
      throw new ModelImportError(
        'external-resources',
        'This model references an external image. Export a single self-contained GLB, or embed every image as a data URI.',
      );
    }
  }
}

function classifyLoaderError(error: unknown): ModelImportError {
  if (error instanceof ModelImportError) return error;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage.replace(/\s+/gu, ' ').trim();
  if (/draco|meshopt|ktx2|basis/iu.test(message)) {
    return new ModelImportError(
      'unsupported-compression',
      'This model uses a compression format that is not supported yet. Export an uncompressed GLB and import it again.',
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  if (/failed to fetch|could not load|uri|resource/iu.test(message)) {
    return new ModelImportError(
      'external-resources',
      'A model resource could not be loaded. Import a self-contained GLB with all buffers and textures embedded.',
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  const detail = message ? ` ${message.slice(0, 180)}` : '';
  return new ModelImportError(
    'invalid-model',
    `ThreeJS Game Studio could not read this glTF model.${detail}`,
    error instanceof Error ? { cause: error } : undefined,
  );
}

async function loadModelSource(source: StoredModelSource): Promise<GLTF> {
  validateSourceSize(source);
  const kind = identifySourceKind(source);
  const document = parseSourceDocument(source, kind);
  validateSelfContainedDocument(document, kind);

  try {
    const loaderData = kind === 'glb' ? source.bytes : new TextDecoder().decode(source.bytes);
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    return await new GLTFLoader().parseAsync(loaderData, '');
  } catch (error) {
    throw classifyLoaderError(error);
  }
}

function geometryTriangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  const vertexCount = index?.count ?? geometry.getAttribute('position')?.count ?? 0;
  return Math.floor(vertexCount / 3);
}

function collectTextures(value: unknown, textures: Set<THREE.Texture>, visited: Set<object>, depth = 0): void {
  if (!value || typeof value !== 'object' || depth > 6) return;
  if ((value as THREE.Texture).isTexture) {
    textures.add(value as THREE.Texture);
    return;
  }
  if (visited.has(value)) return;
  visited.add(value);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectTextures(entry, textures, visited, depth + 1);
    return;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    collectTextures(entry, textures, visited, depth + 1);
  }
}

function vec3(vector: THREE.Vector3): Vec3 {
  return [vector.x, vector.y, vector.z];
}

function uniqueAnimationNames(animations: THREE.AnimationClip[]): string[] {
  const usedNames = new Set<string>();
  return animations.map((animation, index) => {
    const baseName = animation.name.trim() || `Animation ${index + 1}`;
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${baseName} (${suffix})`;
      suffix += 1;
    }
    usedNames.add(name);
    return name;
  });
}

function createDiagnostics(source: StoredModelSource, gltf: GLTF): ModelAssetDiagnostics {
  const meshes = new Set<THREE.Mesh>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let triangles = 0;

  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || meshes.has(mesh)) return;
    meshes.add(mesh);
    const instanceCount = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
    triangles += geometryTriangleCount(mesh.geometry) * instanceCount;
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) materials.add(material);
  });

  if (meshes.size === 0) {
    throw new ModelImportError(
      'invalid-model',
      'This file does not contain any renderable meshes. Choose a model with visible geometry.',
    );
  }

  const visitedTextureValues = new Set<object>();
  for (const material of materials) collectTextures(material, textures, visitedTextureValues);

  const warnings: string[] = [];
  if (source.byteLength > LARGE_MODEL_BYTES) {
    warnings.push(`Large file (${formatBytes(source.byteLength)}). Consider optimizing it for faster loading.`);
  }
  if (triangles > HIGH_TRIANGLE_COUNT) {
    warnings.push(`High geometry count (${formatTriangles(triangles)} triangles). Consider simplifying the model.`);
  }
  if (materials.size > HIGH_MATERIAL_COUNT) {
    warnings.push(`${materials.size} materials may increase draw calls. Consider combining materials.`);
  }
  if (textures.size > HIGH_TEXTURE_COUNT) {
    warnings.push(`${textures.size} textures may use significant GPU memory. Consider combining or resizing textures.`);
  }

  const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
  const min = new THREE.Vector3();
  const max = new THREE.Vector3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  const hasFiniteBounds = [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(
    Number.isFinite,
  );
  if (bounds.isEmpty() || !hasFiniteBounds) {
    warnings.push('The model bounds could not be measured. Check that its meshes contain position data.');
  } else {
    min.copy(bounds.min);
    max.copy(bounds.max);
    bounds.getSize(size);
    bounds.getCenter(center);
    const largestDimension = Math.max(size.x, size.y, size.z);
    const nonZeroDimensions = [size.x, size.y, size.z].filter((dimension) => dimension > 0);
    const smallestDimension = nonZeroDimensions.length > 0 ? Math.min(...nonZeroDimensions) : 0;
    if (
      largestDimension > 10_000 ||
      (largestDimension > 0 && largestDimension < 0.001) ||
      (smallestDimension > 0 && largestDimension / smallestDimension > 1_000_000)
    ) {
      warnings.push('The model has an extreme scale or proportions. Use Fit to Scene after importing it.');
    }
  }

  return {
    meshes: meshes.size,
    triangles,
    materials: materials.size,
    textures: textures.size,
    animationNames: uniqueAnimationNames(gltf.animations),
    bounds: {
      min: vec3(min),
      max: vec3(max),
      size: vec3(size),
      center: vec3(center),
    },
    warnings,
  };
}

export async function analyzeModelFile(file: File): Promise<{
  source: StoredModelSource;
  diagnostics: ModelAssetDiagnostics;
}> {
  const sourceKind = kindFromMetadata(file.name, file.type);
  if (!sourceKind) {
    throw new ModelImportError(
      'unsupported-file',
      'Choose a .glb or .gltf file. Convert FBX, OBJ, and other formats to glTF 2.0 before importing.',
    );
  }
  if (file.size > MAX_MODEL_BYTES) {
    throw new ModelImportError(
      'too-large',
      `This model is ${formatBytes(file.size)}. Import a model smaller than ${formatBytes(MAX_MODEL_BYTES)}.`,
    );
  }
  if (file.size === 0) throw new ModelImportError('invalid-model', 'The selected model file is empty.');

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (error) {
    throw new ModelImportError('invalid-model', 'The browser could not read this model file. Try selecting it again.', {
      cause: error,
    });
  }

  const source: StoredModelSource = {
    fileName: file.name,
    mimeType: file.type || (sourceKind === 'glb' ? 'model/gltf-binary' : 'model/gltf+json'),
    byteLength: bytes.byteLength,
    bytes,
  };
  const gltf = await loadModelSource(source);
  try {
    return { source, diagnostics: createDiagnostics(source, gltf) };
  } finally {
    disposeModelResources(gltf.scene);
  }
}

export async function parseModelSource(source: StoredModelSource): Promise<{
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}> {
  const gltf = await loadModelSource(source);
  return { scene: gltf.scene, animations: gltf.animations };
}

export function disposeModelResources(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      geometries.add(mesh.geometry);
      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of meshMaterials) materials.add(material);
    }
    const skinnedMesh = object as THREE.SkinnedMesh;
    if (skinnedMesh.isSkinnedMesh && skinnedMesh.skeleton.boneTexture) textures.add(skinnedMesh.skeleton.boneTexture);
  });

  const visitedTextureValues = new Set<object>();
  for (const material of materials) collectTextures(material, textures, visitedTextureValues);
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}
