import type {
  Axis,
  CameraData,
  GameplayComponent,
  LightData,
  MaterialData,
  ModelAssetDiagnostics,
  ModelAssetRecord,
  PrimitiveType,
  ProjectDocument,
  SceneNode,
  StudioAsset,
  TransformData,
} from './types';

const transform = (
  position: TransformData['position'] = [0, 0, 0],
  rotation: TransformData['rotation'] = [0, 0, 0],
  scale: TransformData['scale'] = [1, 1, 1],
): TransformData => ({ position, rotation, scale });

const material = (
  color: string,
  roughness = 0.45,
  metalness = 0.08,
  emissive = '#000000',
  emissiveIntensity = 0,
): MaterialData => ({ color, roughness, metalness, emissive, emissiveIntensity });

const createProjectId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `project-${Date.now().toString(36)}`;

export const createNodeId = (prefix = 'entity') =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;

const createComponentId = (type: GameplayComponent['type']) => createNodeId(`component-${type}`);

export function createGameplayComponent(type: 'rotate'): Extract<GameplayComponent, { type: 'rotate' }>;
export function createGameplayComponent(type: 'float'): Extract<GameplayComponent, { type: 'float' }>;
export function createGameplayComponent(type: 'keyboardMove'): Extract<GameplayComponent, { type: 'keyboardMove' }>;
export function createGameplayComponent(type: GameplayComponent['type']): GameplayComponent;
export function createGameplayComponent(type: GameplayComponent['type']): GameplayComponent {
  if (type === 'float') {
    return { id: createComponentId(type), type, enabled: true, speed: 1, distance: 0.25, axis: 'y', phase: 0 };
  }
  if (type === 'keyboardMove') {
    return { id: createComponentId(type), type, enabled: true, speed: 3.5, plane: 'xz' };
  }
  return { id: createComponentId(type), type, enabled: true, speed: 0.8, axis: 'y' };
}

export const BUILT_IN_ASSETS: StudioAsset[] = [
  { id: 'scene-main', name: 'MainWorld', kind: 'scene', meta: 'Scene · 13 objects' },
  { id: 'primitive-box', name: 'Crate', kind: 'primitive', primitive: 'box', color: '#8493a8', meta: 'Prefab · Mesh' },
  { id: 'primitive-capsule', name: 'Player Capsule', kind: 'primitive', primitive: 'capsule', color: '#53e0cf', meta: 'Prefab · Mesh' },
  { id: 'primitive-sphere', name: 'Energy Orb', kind: 'primitive', primitive: 'sphere', color: '#a78bfa', meta: 'Prefab · Mesh' },
  { id: 'primitive-torus', name: 'Energy Ring', kind: 'primitive', primitive: 'torus', color: '#f6c177', meta: 'Prefab · Mesh' },
  { id: 'primitive-cylinder', name: 'Column', kind: 'primitive', primitive: 'cylinder', color: '#69788e', meta: 'Prefab · Mesh' },
  { id: 'material-graphite', name: 'Graphite', kind: 'material', color: '#202a36', meta: 'Material · PBR' },
  { id: 'material-cyan', name: 'Neon Cyan', kind: 'material', color: '#55ead7', meta: 'Material · Emissive' },
  { id: 'material-violet', name: 'Studio Violet', kind: 'material', color: '#9b87f5', meta: 'Material · Emissive' },
  { id: 'material-coral', name: 'Signal Coral', kind: 'material', color: '#f47f6b', meta: 'Material · PBR' },
  { id: 'material-concrete', name: 'Soft Concrete', kind: 'material', color: '#7e8b9d', meta: 'Material · Rough' },
];

export function createStarterProject(): ProjectDocument {
  return {
    schemaVersion: 3,
    id: createProjectId(),
    name: 'Starter Project',
    sceneName: 'MainWorld',
    updatedAt: new Date().toISOString(),
    settings: {
      background: '#111823',
      fogColor: '#111823',
      fogNear: 18,
      fogFar: 56,
      fogEnabled: true,
      exposure: 1.08,
      gridSize: 30,
      gridDivisions: 30,
      shadows: true,
    },
    assets: [],
    nodes: [
      {
        id: 'scene-root',
        name: 'MainWorld',
        kind: 'group',
        parentId: null,
        visible: true,
        locked: true,
        transform: transform(),
        components: [],
      },
      {
        id: 'environment',
        name: 'Environment',
        kind: 'group',
        parentId: 'scene-root',
        visible: true,
        locked: false,
        transform: transform(),
        components: [],
      },
      {
        id: 'ground',
        name: 'Ground Plane',
        kind: 'mesh',
        primitive: 'plane',
        parentId: 'environment',
        visible: true,
        locked: false,
        transform: transform([0, -0.06, 0], [-Math.PI / 2, 0, 0], [28, 28, 1]),
        material: material('#26303c', 0.88, 0.04),
        receiveShadow: true,
        components: [],
      },
      {
        id: 'platform',
        name: 'Hero Platform',
        kind: 'mesh',
        primitive: 'cylinder',
        parentId: 'environment',
        visible: true,
        locked: false,
        transform: transform([0, 0.28, 0], [0, 0, 0], [4.6, 0.56, 4.6]),
        material: material('#303c4c', 0.32, 0.52),
        castShadow: true,
        receiveShadow: true,
        components: [],
      },
      {
        id: 'arch-left',
        name: 'Arch Left',
        kind: 'mesh',
        primitive: 'box',
        parentId: 'environment',
        visible: true,
        locked: false,
        transform: transform([-4.5, 2.4, -3.8], [0, 0.12, 0], [0.55, 4.8, 0.72]),
        material: material('#39475a', 0.38, 0.36),
        castShadow: true,
        receiveShadow: true,
        components: [],
      },
      {
        id: 'arch-right',
        name: 'Arch Right',
        kind: 'mesh',
        primitive: 'box',
        parentId: 'environment',
        visible: true,
        locked: false,
        transform: transform([4.5, 2.4, -3.8], [0, -0.12, 0], [0.55, 4.8, 0.72]),
        material: material('#39475a', 0.38, 0.36),
        castShadow: true,
        receiveShadow: true,
        components: [],
      },
      {
        id: 'arch-top',
        name: 'Arch Header',
        kind: 'mesh',
        primitive: 'box',
        parentId: 'environment',
        visible: true,
        locked: false,
        transform: transform([0, 4.7, -3.8], [0, 0, 0], [9.55, 0.55, 0.72]),
        material: material('#354356', 0.38, 0.42, '#263b49', 0.2),
        castShadow: true,
        receiveShadow: true,
        components: [],
      },
      {
        id: 'player-rig',
        name: 'Player Rig',
        kind: 'group',
        parentId: 'scene-root',
        visible: true,
        locked: false,
        transform: transform([0, 1.55, 0]),
        components: [
          { id: 'player-move', type: 'keyboardMove', enabled: true, speed: 3.5, plane: 'xz' },
        ],
      },
      {
        id: 'player-core',
        name: 'Player Core',
        kind: 'mesh',
        primitive: 'capsule',
        parentId: 'player-rig',
        visible: true,
        locked: false,
        transform: transform([0, 0.2, 0], [0, 0, 0], [1.15, 1.15, 1.15]),
        material: material('#51dfce', 0.24, 0.58, '#1fd8c3', 0.42),
        castShadow: true,
        receiveShadow: true,
        components: [
          { id: 'player-core-float', type: 'float', enabled: true, speed: 1.25, distance: 0.12, axis: 'y', phase: 0 },
        ],
      },
      {
        id: 'player-ring',
        name: 'Orbit Ring',
        kind: 'mesh',
        primitive: 'torus',
        parentId: 'player-rig',
        visible: true,
        locked: false,
        transform: transform([0, 0.15, 0], [Math.PI / 2, 0, 0], [1.65, 1.65, 1.65]),
        material: material('#a58bf5', 0.2, 0.72, '#7659f2', 0.6),
        castShadow: true,
        components: [
          { id: 'player-ring-rotate', type: 'rotate', enabled: true, speed: 0.72, axis: 'y' },
        ],
      },
      {
        id: 'main-camera',
        name: 'Main Camera',
        kind: 'camera',
        parentId: 'scene-root',
        visible: true,
        locked: false,
        transform: transform([9, 6.5, 11], [-0.34, 0.68, 0]),
        camera: { fov: 48, near: 0.1, far: 200, primary: true },
        components: [],
      },
      {
        id: 'key-light',
        name: 'Key Light',
        kind: 'light',
        parentId: 'scene-root',
        visible: true,
        locked: false,
        transform: transform([6, 10, 7], [-0.8, 0.55, 0]),
        light: { type: 'directional', color: '#d8eeff', intensity: 3.2, distance: 18, castShadow: true },
        components: [],
      },
      {
        id: 'rim-light',
        name: 'Rim Light',
        kind: 'light',
        parentId: 'scene-root',
        visible: true,
        locked: false,
        transform: transform([-4, 4.5, -2], [0, 0, 0]),
        light: { type: 'point', color: '#8b72ff', intensity: 34, distance: 15, castShadow: false },
        components: [],
      },
    ],
  };
}

export function cloneProject(project: ProjectDocument): ProjectDocument {
  return structuredClone(project);
}

export function getNode(project: ProjectDocument, id: string | null): SceneNode | undefined {
  return id ? project.nodes.find((node) => node.id === id) : undefined;
}

export function updateNode(
  project: ProjectDocument,
  id: string,
  update: Partial<SceneNode> | ((node: SceneNode) => SceneNode),
): ProjectDocument {
  const next = cloneProject(project);
  next.updatedAt = new Date().toISOString();
  next.nodes = next.nodes.map((node) => {
    if (node.id !== id) return node;
    return typeof update === 'function' ? update(node) : { ...node, ...update };
  });
  return next;
}

const defaultName = (primitive: PrimitiveType) =>
  ({
    box: 'Box',
    sphere: 'Sphere',
    capsule: 'Capsule',
    cylinder: 'Cylinder',
    cone: 'Cone',
    plane: 'Plane',
    torus: 'Torus',
  })[primitive];

const defaultScale = (primitive: PrimitiveType): TransformData['scale'] => {
  if (primitive === 'plane') return [5, 5, 1];
  if (primitive === 'torus') return [1.25, 1.25, 1.25];
  return [1, 1, 1];
};

export function addPrimitive(
  project: ProjectDocument,
  primitive: PrimitiveType,
  parentId: string | null = 'scene-root',
  color = '#7f91a8',
): { project: ProjectDocument; nodeId: string } {
  const next = cloneProject(project);
  const nodeId = createNodeId(primitive);
  const siblingCount = next.nodes.filter((node) => node.primitive === primitive).length;
  next.nodes.push({
    id: nodeId,
    name: `${defaultName(primitive)} ${String(siblingCount + 1).padStart(2, '0')}`,
    kind: 'mesh',
    primitive,
    parentId,
    visible: true,
    locked: false,
    transform: transform([0, primitive === 'plane' ? 0 : 0.65, 0], primitive === 'plane' ? [-Math.PI / 2, 0, 0] : [0, 0, 0], defaultScale(primitive)),
    material: material(color, primitive === 'plane' ? 0.82 : 0.42, primitive === 'plane' ? 0.02 : 0.16),
    castShadow: primitive !== 'plane',
    receiveShadow: true,
    components: [],
  });
  next.updatedAt = new Date().toISOString();
  return { project: next, nodeId };
}

function nextModelInstanceName(project: ProjectDocument, asset: ModelAssetRecord) {
  const count = project.nodes.filter((node) => node.kind === 'model' && node.model?.assetId === asset.id).length;
  return count === 0 ? asset.name : `${asset.name} ${count + 1}`;
}

export function addModelInstance(
  project: ProjectDocument,
  assetId: string,
  parentId: string | null = 'scene-root',
): { project: ProjectDocument; nodeId: string } | null {
  const asset = project.assets.find((entry) => entry.id === assetId);
  if (!asset) return null;
  const next = cloneProject(project);
  const nodeId = createNodeId('model');
  next.nodes.push({
    id: nodeId,
    name: nextModelInstanceName(project, asset),
    kind: 'model',
    parentId,
    visible: true,
    locked: false,
    transform: transform(),
    model: { assetId, fitMode: 'fit', targetSize: 2.5 },
    castShadow: true,
    receiveShadow: true,
    components: [],
  });
  next.updatedAt = new Date().toISOString();
  return { project: next, nodeId };
}

export function addModelAsset(
  project: ProjectDocument,
  asset: ModelAssetRecord,
  parentId: string | null = 'scene-root',
): { project: ProjectDocument; nodeId: string } {
  const next = cloneProject(project);
  next.assets.push(structuredClone(asset));
  const instance = addModelInstance(next, asset.id, parentId);
  if (!instance) throw new Error(`Could not create an instance for model asset ${asset.id}.`);
  return instance;
}

export function duplicateNode(
  project: ProjectDocument,
  id: string,
): { project: ProjectDocument; nodeId: string } | null {
  const original = getNode(project, id);
  if (!original || original.id === 'scene-root') return null;

  const next = cloneProject(project);
  const idMap = new Map<string, string>();
  const descendants = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of project.nodes) {
      if (node.parentId && descendants.has(node.parentId) && !descendants.has(node.id)) {
        descendants.add(node.id);
        changed = true;
      }
    }
  }

  for (const nodeId of descendants) idMap.set(nodeId, createNodeId('copy'));
  const clones = project.nodes
    .filter((node) => descendants.has(node.id))
    .map((node) => {
      const copy = structuredClone(node);
      copy.id = idMap.get(node.id) ?? copy.id;
      copy.parentId = node.id === id ? node.parentId : node.parentId ? idMap.get(node.parentId) ?? node.parentId : null;
      if (node.id === id) {
        copy.name = `${node.name} Copy`;
        copy.transform.position = [node.transform.position[0] + 1.25, node.transform.position[1], node.transform.position[2] + 0.35];
      }
      copy.components = copy.components.map((component) => ({ ...component, id: createComponentId(component.type) }));
      return copy;
    });

  next.nodes.push(...clones);
  next.updatedAt = new Date().toISOString();
  return { project: next, nodeId: idMap.get(id) ?? id };
}

export function removeNode(project: ProjectDocument, id: string): ProjectDocument {
  if (id === 'scene-root') return project;
  const removed = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of project.nodes) {
      if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) {
        removed.add(node.id);
        changed = true;
      }
    }
  }
  const next = cloneProject(project);
  next.nodes = next.nodes.filter((node) => !removed.has(node.id));
  next.updatedAt = new Date().toISOString();
  return next;
}

export function applyMaterial(project: ProjectDocument, id: string, color: string): ProjectDocument {
  return updateNode(project, id, (node) => {
    if (node.kind !== 'mesh' || !node.material) return node;
    const emissive = color === '#55ead7' || color === '#9b87f5' ? color : '#000000';
    return {
      ...node,
      material: {
        ...node.material,
        color,
        emissive,
        emissiveIntensity: emissive === '#000000' ? 0 : 0.32,
      },
    };
  });
}

type UnknownRecord = Record<string, unknown>;

export type LoadProjectDocumentResult =
  | { ok: true; project: ProjectDocument; warnings: string[] }
  | { ok: false; errors: string[] };

const nodeKinds = ['group', 'mesh', 'model', 'light', 'camera'] as const;
const primitives = ['box', 'sphere', 'capsule', 'cylinder', 'cone', 'plane', 'torus'] as const;
const axes = ['x', 'y', 'z'] as const;

const isRecord = (value: unknown): value is UnknownRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function stringAt(record: UnknownRecord, key: string, path: string, errors: string[], fallback = '') {
  const value = record[key];
  if (typeof value === 'string') return value;
  errors.push(`${path} must be a string.`);
  return fallback;
}

function numberAt(record: UnknownRecord, key: string, path: string, errors: string[], fallback = 0) {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  errors.push(`${path} must be a finite number.`);
  return fallback;
}

function booleanAt(record: UnknownRecord, key: string, path: string, errors: string[], fallback = false) {
  const value = record[key];
  if (typeof value === 'boolean') return value;
  errors.push(`${path} must be a boolean.`);
  return fallback;
}

function integerAt(record: UnknownRecord, key: string, path: string, errors: string[], fallback = 0) {
  const value = record[key];
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  errors.push(`${path} must be a non-negative integer.`);
  return fallback;
}

function vec3At(value: unknown, path: string, errors: string[], fallback: TransformData['position']): TransformData['position'] {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  ) {
    return [value[0], value[1], value[2]];
  }
  errors.push(`${path} must contain exactly three finite numbers.`);
  return fallback;
}

function clampWithWarning(value: number, min: number, max: number, path: string, warnings: string[]) {
  const next = Math.min(max, Math.max(min, value));
  if (next !== value) warnings.push(`${path} was clamped to ${next}.`);
  return next;
}

function normalizeTransform(value: unknown, path: string, errors: string[]): TransformData {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return transform();
  }
  return {
    position: vec3At(value.position, `${path}.position`, errors, [0, 0, 0]),
    rotation: vec3At(value.rotation, `${path}.rotation`, errors, [0, 0, 0]),
    scale: vec3At(value.scale, `${path}.scale`, errors, [1, 1, 1]),
  };
}

function normalizeMaterial(value: unknown, path: string, errors: string[]): MaterialData | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object for mesh nodes.`);
    return undefined;
  }
  return {
    color: stringAt(value, 'color', `${path}.color`, errors, '#ffffff'),
    emissive: stringAt(value, 'emissive', `${path}.emissive`, errors, '#000000'),
    emissiveIntensity: numberAt(value, 'emissiveIntensity', `${path}.emissiveIntensity`, errors),
    metalness: numberAt(value, 'metalness', `${path}.metalness`, errors),
    roughness: numberAt(value, 'roughness', `${path}.roughness`, errors, 0.5),
  };
}

function normalizeLight(value: unknown, path: string, errors: string[]): LightData | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object for light nodes.`);
    return undefined;
  }
  const type = value.type;
  if (type !== 'directional' && type !== 'point' && type !== 'spot') errors.push(`${path}.type is not supported.`);
  return {
    type: type === 'point' || type === 'spot' ? type : 'directional',
    color: stringAt(value, 'color', `${path}.color`, errors, '#ffffff'),
    intensity: numberAt(value, 'intensity', `${path}.intensity`, errors, 1),
    distance: numberAt(value, 'distance', `${path}.distance`, errors),
    castShadow: booleanAt(value, 'castShadow', `${path}.castShadow`, errors),
  };
}

function normalizeCamera(value: unknown, path: string, errors: string[]): CameraData | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object for camera nodes.`);
    return undefined;
  }
  return {
    fov: numberAt(value, 'fov', `${path}.fov`, errors, 48),
    near: numberAt(value, 'near', `${path}.near`, errors, 0.1),
    far: numberAt(value, 'far', `${path}.far`, errors, 200),
    primary: booleanAt(value, 'primary', `${path}.primary`, errors),
  };
}

function normalizeModelAsset(value: unknown, path: string, errors: string[]): ModelAssetRecord | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }
  if (value.kind !== 'model') errors.push(`${path}.kind must be "model".`);
  const diagnosticsValue = value.diagnostics;
  if (!isRecord(diagnosticsValue)) errors.push(`${path}.diagnostics must be an object.`);
  const diagnosticsRecord = isRecord(diagnosticsValue) ? diagnosticsValue : {};
  const boundsValue = diagnosticsRecord.bounds;
  if (!isRecord(boundsValue)) errors.push(`${path}.diagnostics.bounds must be an object.`);
  const boundsRecord = isRecord(boundsValue) ? boundsValue : {};
  const animationNamesValue = diagnosticsRecord.animationNames;
  if (!Array.isArray(animationNamesValue) || !animationNamesValue.every((entry) => typeof entry === 'string')) {
    errors.push(`${path}.diagnostics.animationNames must be an array of strings.`);
  }
  const warningsValue = diagnosticsRecord.warnings;
  if (!Array.isArray(warningsValue) || !warningsValue.every((entry) => typeof entry === 'string')) {
    errors.push(`${path}.diagnostics.warnings must be an array of strings.`);
  }
  const diagnostics: ModelAssetDiagnostics = {
    meshes: integerAt(diagnosticsRecord, 'meshes', `${path}.diagnostics.meshes`, errors),
    triangles: integerAt(diagnosticsRecord, 'triangles', `${path}.diagnostics.triangles`, errors),
    materials: integerAt(diagnosticsRecord, 'materials', `${path}.diagnostics.materials`, errors),
    textures: integerAt(diagnosticsRecord, 'textures', `${path}.diagnostics.textures`, errors),
    animationNames: Array.isArray(animationNamesValue)
      ? animationNamesValue.filter((entry): entry is string => typeof entry === 'string')
      : [],
    bounds: {
      min: vec3At(boundsRecord.min, `${path}.diagnostics.bounds.min`, errors, [0, 0, 0]),
      max: vec3At(boundsRecord.max, `${path}.diagnostics.bounds.max`, errors, [0, 0, 0]),
      size: vec3At(boundsRecord.size, `${path}.diagnostics.bounds.size`, errors, [0, 0, 0]),
      center: vec3At(boundsRecord.center, `${path}.diagnostics.bounds.center`, errors, [0, 0, 0]),
    },
    warnings: Array.isArray(warningsValue)
      ? warningsValue.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
  const revision = integerAt(value, 'revision', `${path}.revision`, errors, 1);
  if (revision < 1) errors.push(`${path}.revision must be at least 1.`);
  return {
    id: stringAt(value, 'id', `${path}.id`, errors),
    kind: 'model',
    name: stringAt(value, 'name', `${path}.name`, errors, 'Untitled Model'),
    sourceFilename: stringAt(value, 'sourceFilename', `${path}.sourceFilename`, errors),
    mimeType: stringAt(value, 'mimeType', `${path}.mimeType`, errors),
    byteLength: integerAt(value, 'byteLength', `${path}.byteLength`, errors),
    revision: Math.max(1, revision),
    importedAt: stringAt(value, 'importedAt', `${path}.importedAt`, errors),
    diagnostics,
  };
}

function normalizeModelInstance(value: unknown, path: string, errors: string[]): SceneNode['model'] {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object for model nodes.`);
    return undefined;
  }
  const fitMode = value.fitMode;
  if (fitMode !== 'fit' && fitMode !== 'original') errors.push(`${path}.fitMode must be "fit" or "original".`);
  const targetSize = numberAt(value, 'targetSize', `${path}.targetSize`, errors, 2.5);
  if (targetSize <= 0) errors.push(`${path}.targetSize must be greater than 0.`);
  return {
    assetId: stringAt(value, 'assetId', `${path}.assetId`, errors),
    fitMode: fitMode === 'original' ? 'original' : 'fit',
    targetSize: Math.max(0.001, targetSize),
  };
}

function normalizeComponent(
  value: unknown,
  path: string,
  errors: string[],
  warnings: string[],
  usedIds: Set<string>,
): GameplayComponent | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }
  const type = value.type;
  if (type !== 'rotate' && type !== 'float' && type !== 'keyboardMove') {
    errors.push(`${path}.type is not supported.`);
    return null;
  }
  let id = typeof value.id === 'string' && value.id ? value.id : createComponentId(type);
  if (typeof value.id !== 'string' || !value.id) warnings.push(`${path}.id was generated.`);
  if (usedIds.has(id)) {
    id = createComponentId(type);
    warnings.push(`${path}.id was duplicated and has been replaced.`);
  }
  usedIds.add(id);
  const enabled = booleanAt(value, 'enabled', `${path}.enabled`, errors, true);
  const speed = numberAt(value, 'speed', `${path}.speed`, errors, type === 'keyboardMove' ? 3.5 : 1);
  if (type === 'keyboardMove') {
    const plane = value.plane;
    if (plane !== 'xz' && plane !== 'xy') errors.push(`${path}.plane must be "xz" or "xy".`);
    return { id, type, enabled, speed, plane: plane === 'xy' ? 'xy' : 'xz' };
  }
  const axisValue = value.axis;
  if (!axes.includes(axisValue as Axis)) errors.push(`${path}.axis must be "x", "y", or "z".`);
  const axis = axes.includes(axisValue as Axis) ? (axisValue as Axis) : 'y';
  if (type === 'float') {
    return {
      id,
      type,
      enabled,
      speed,
      distance: numberAt(value, 'distance', `${path}.distance`, errors, 0.25),
      axis,
      phase: numberAt(value, 'phase', `${path}.phase`, errors),
    };
  }
  return { id, type, enabled, speed, axis };
}

function migrateVersionOne(value: UnknownRecord, warnings: string[]): UnknownRecord {
  const migrated = structuredClone(value) as UnknownRecord;
  migrated.schemaVersion = 2;
  const settings = isRecord(migrated.settings) ? migrated.settings : {};
  migrated.settings = { ...settings, fogEnabled: true, exposure: 1.08 };
  let converted = 0;
  if (Array.isArray(migrated.nodes)) {
    migrated.nodes = migrated.nodes.map((entry, index) => {
      if (!isRecord(entry)) return entry;
      const node = { ...entry };
      const existing = Array.isArray(node.components) ? [...node.components] : [];
      const behavior = node.behavior;
      if (isRecord(behavior) && (behavior.type === 'rotate' || behavior.type === 'float')) {
        const nodeId = typeof node.id === 'string' ? node.id : String(index);
        const enabled = typeof behavior.enabled === 'boolean' ? behavior.enabled : true;
        const speed = typeof behavior.speed === 'number' && Number.isFinite(behavior.speed) ? behavior.speed : 1;
        existing.push(
          behavior.type === 'rotate'
            ? { id: `legacy-${nodeId}-rotate`, type: 'rotate', enabled, speed, axis: 'y' }
            : {
                id: `legacy-${nodeId}-float`,
                type: 'float',
                enabled,
                speed,
                distance:
                  typeof behavior.amplitude === 'number' && Number.isFinite(behavior.amplitude) ? behavior.amplitude : 0.25,
                axis: 'y',
                phase: 0,
              },
        );
        converted += 1;
      } else if (behavior !== undefined) {
        warnings.push(`nodes[${index}].behavior was not recognized and was skipped during migration.`);
      }
      node.components = existing;
      delete node.behavior;
      return node;
    });
  }
  warnings.push(`Migrated project schema from v1 to v2${converted ? ` and converted ${converted} behavior${converted === 1 ? '' : 's'}` : ''}.`);
  return migrated;
}

function migrateVersionTwo(value: UnknownRecord, warnings: string[]): UnknownRecord {
  const migrated = structuredClone(value) as UnknownRecord;
  migrated.schemaVersion = 3;
  if (!Array.isArray(migrated.assets)) migrated.assets = [];
  warnings.push('Migrated project schema from v2 to v3 and initialized the model asset catalog.');
  return migrated;
}

export function loadProjectDocument(value: unknown): LoadProjectDocumentResult {
  if (!isRecord(value)) return { ok: false, errors: ['Project must be a JSON object.'] };
  if (typeof value.schemaVersion === 'number' && value.schemaVersion > 3) {
    return { ok: false, errors: [`Project schema v${value.schemaVersion} is newer than this editor supports.`] };
  }
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3) {
    return { ok: false, errors: ['schemaVersion must be 1, 2, or 3.'] };
  }

  const warnings: string[] = [];
  let source = structuredClone(value) as UnknownRecord;
  if (source.schemaVersion === 1) source = migrateVersionOne(source, warnings);
  if (source.schemaVersion === 2) source = migrateVersionTwo(source, warnings);
  const errors: string[] = [];
  const settingsValue = source.settings;
  if (!isRecord(settingsValue)) errors.push('settings must be an object.');
  const settingsRecord = isRecord(settingsValue) ? settingsValue : {};
  const fogNear = clampWithWarning(
    numberAt(settingsRecord, 'fogNear', 'settings.fogNear', errors, 18),
    0,
    100_000,
    'settings.fogNear',
    warnings,
  );
  let fogFar = numberAt(settingsRecord, 'fogFar', 'settings.fogFar', errors, 56);
  if (fogFar <= fogNear) {
    fogFar = fogNear + 1;
    warnings.push(`settings.fogFar was raised to ${fogFar} so it is beyond fogNear.`);
  }
  const settings: ProjectDocument['settings'] = {
    background: stringAt(settingsRecord, 'background', 'settings.background', errors, '#111823'),
    fogColor: stringAt(settingsRecord, 'fogColor', 'settings.fogColor', errors, '#111823'),
    fogNear,
    fogFar,
    fogEnabled: booleanAt(settingsRecord, 'fogEnabled', 'settings.fogEnabled', errors, true),
    exposure: clampWithWarning(numberAt(settingsRecord, 'exposure', 'settings.exposure', errors, 1.08), 0.1, 4, 'settings.exposure', warnings),
    gridSize: clampWithWarning(numberAt(settingsRecord, 'gridSize', 'settings.gridSize', errors, 30), 1, 1000, 'settings.gridSize', warnings),
    gridDivisions: Math.round(clampWithWarning(numberAt(settingsRecord, 'gridDivisions', 'settings.gridDivisions', errors, 30), 1, 1000, 'settings.gridDivisions', warnings)),
    shadows: booleanAt(settingsRecord, 'shadows', 'settings.shadows', errors, true),
  };

  const assetsValue = source.assets;
  if (!Array.isArray(assetsValue)) errors.push('assets must be an array.');
  const usedAssetIds = new Set<string>();
  const assets: ModelAssetRecord[] = (Array.isArray(assetsValue) ? assetsValue : []).flatMap((entry, index) => {
    const asset = normalizeModelAsset(entry, `assets[${index}]`, errors);
    if (!asset) return [];
    if (usedAssetIds.has(asset.id)) errors.push(`assets[${index}].id duplicates asset id "${asset.id}".`);
    usedAssetIds.add(asset.id);
    return [asset];
  });

  const nodesValue = source.nodes;
  if (!Array.isArray(nodesValue)) errors.push('nodes must be an array.');
  const usedNodeIds = new Set<string>();
  const usedComponentIds = new Set<string>();
  const nodes: SceneNode[] = (Array.isArray(nodesValue) ? nodesValue : []).flatMap((entry, index) => {
    const path = `nodes[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${path} must be an object.`);
      return [];
    }
    const id = stringAt(entry, 'id', `${path}.id`, errors);
    if (usedNodeIds.has(id)) errors.push(`${path}.id duplicates node id "${id}".`);
    usedNodeIds.add(id);
    const kindValue = entry.kind;
    if (!nodeKinds.includes(kindValue as SceneNode['kind'])) errors.push(`${path}.kind is not supported.`);
    const kind: SceneNode['kind'] = nodeKinds.includes(kindValue as SceneNode['kind'])
      ? (kindValue as SceneNode['kind'])
      : 'group';
    const parentValue = entry.parentId;
    if (parentValue !== null && typeof parentValue !== 'string') errors.push(`${path}.parentId must be a string or null.`);
    const componentValues = entry.components;
    if (!Array.isArray(componentValues)) errors.push(`${path}.components must be an array.`);
    const components = (Array.isArray(componentValues) ? componentValues : []).flatMap((component, componentIndex) => {
      const normalized = normalizeComponent(component, `${path}.components[${componentIndex}]`, errors, warnings, usedComponentIds);
      return normalized ? [normalized] : [];
    });
    const node: SceneNode = {
      id,
      name: stringAt(entry, 'name', `${path}.name`, errors, 'Untitled'),
      kind,
      parentId: typeof parentValue === 'string' ? parentValue : null,
      visible: booleanAt(entry, 'visible', `${path}.visible`, errors, true),
      locked: booleanAt(entry, 'locked', `${path}.locked`, errors),
      transform: normalizeTransform(entry.transform, `${path}.transform`, errors),
      components,
    };
    if (kind === 'mesh') {
      const primitiveValue = entry.primitive;
      if (!primitives.includes(primitiveValue as PrimitiveType)) errors.push(`${path}.primitive is not supported.`);
      node.primitive = primitives.includes(primitiveValue as PrimitiveType) ? (primitiveValue as PrimitiveType) : 'box';
      node.material = normalizeMaterial(entry.material, `${path}.material`, errors);
      if (entry.castShadow !== undefined) node.castShadow = booleanAt(entry, 'castShadow', `${path}.castShadow`, errors);
      if (entry.receiveShadow !== undefined) node.receiveShadow = booleanAt(entry, 'receiveShadow', `${path}.receiveShadow`, errors);
    } else if (kind === 'model') {
      node.model = normalizeModelInstance(entry.model, `${path}.model`, errors);
      if (entry.castShadow !== undefined) node.castShadow = booleanAt(entry, 'castShadow', `${path}.castShadow`, errors);
      if (entry.receiveShadow !== undefined) node.receiveShadow = booleanAt(entry, 'receiveShadow', `${path}.receiveShadow`, errors);
    } else if (kind === 'light') {
      node.light = normalizeLight(entry.light, `${path}.light`, errors);
    } else if (kind === 'camera') {
      node.camera = normalizeCamera(entry.camera, `${path}.camera`, errors);
    }
    return [node];
  });

  for (const [index, node] of nodes.entries()) {
    if (node.parentId && !usedNodeIds.has(node.parentId)) errors.push(`nodes[${index}].parentId references missing node "${node.parentId}".`);
    if (node.kind === 'model' && node.model && !usedAssetIds.has(node.model.assetId)) {
      errors.push(`nodes[${index}].model.assetId references missing asset "${node.model.assetId}".`);
    }
  }
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const [index, node] of nodes.entries()) {
    const chain = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (chain.has(parentId)) {
        errors.push(`nodes[${index}].parentId creates a hierarchy cycle through "${parentId}".`);
        break;
      }
      chain.add(parentId);
      parentId = nodesById.get(parentId)?.parentId ?? null;
    }
  }
  if (!nodes.some((node) => node.parentId === null)) errors.push('nodes must include at least one root node.');

  const id = stringAt(source, 'id', 'id', errors);
  const name = stringAt(source, 'name', 'name', errors, 'Untitled Project');
  const sceneName = stringAt(source, 'sceneName', 'sceneName', errors, 'MainWorld');
  const updatedAt = stringAt(source, 'updatedAt', 'updatedAt', errors, new Date().toISOString());

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    project: {
      schemaVersion: 3,
      id,
      name,
      sceneName,
      updatedAt,
      settings,
      assets,
      nodes,
    },
  };
}

export function isProjectDocument(value: unknown): value is ProjectDocument {
  if (!isRecord(value) || value.schemaVersion !== 3 || !Array.isArray(value.assets) || !Array.isArray(value.nodes) || !isRecord(value.settings)) return false;
  const result = loadProjectDocument(value);
  return (
    typeof value.name === 'string' &&
    typeof value.settings.fogEnabled === 'boolean' &&
    typeof value.settings.exposure === 'number' &&
    value.nodes.every((node) => isRecord(node) && Array.isArray(node.components)) &&
    result.ok &&
    result.warnings.length === 0
  );
}

export function downloadTextFile(contents: string, filename: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildRuntimeHtml(project: ProjectDocument, embeddedAssets: Record<string, string> = {}): string {
  const serialized = JSON.stringify(project).replaceAll('<', '\\u003c');
  const serializedAssets = JSON.stringify(embeddedAssets).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${project.name.replaceAll('<', '&lt;')}</title>
  <style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#090d12;color:#eef5f4;font-family:Inter,system-ui,sans-serif}canvas{display:block;width:100%;height:100%}.badge{position:fixed;left:18px;bottom:18px;padding:9px 12px;border:1px solid #ffffff24;border-radius:8px;background:#0d131ccc;backdrop-filter:blur(12px);font-size:12px;letter-spacing:.03em}.badge b{color:#57e4d2}.hint{position:fixed;right:18px;bottom:18px;color:#9ba9b9;font-size:12px}
  </style>
  <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/"}}</script>
</head>
<body>
  <div class="badge"><b>THREEJS</b> GAME STUDIO · ${project.sceneName.replaceAll('<', '&lt;')}</div>
  <div class="hint">Drag to orbit · Scroll to zoom · WASD / arrows move</div>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
    const project = ${serialized};
    const embeddedAssets = ${serializedAssets};
    async function boot(){
      const renderer = new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
      renderer.setPixelRatio(Math.min(devicePixelRatio,2));
      renderer.setSize(innerWidth,innerHeight);
      renderer.shadowMap.enabled=project.settings.shadows;
      renderer.shadowMap.type=THREE.PCFShadowMap;
      renderer.outputColorSpace=THREE.SRGBColorSpace;
      renderer.toneMapping=THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure=project.settings.exposure;
      document.body.prepend(renderer.domElement);
      const scene=new THREE.Scene();
      scene.background=new THREE.Color(project.settings.background);
      scene.fog=project.settings.fogEnabled?new THREE.Fog(project.settings.fogColor,project.settings.fogNear,project.settings.fogFar):null;
      scene.add(new THREE.HemisphereLight(0xbfd9ff,0x1a2028,1.15));
      const referencedAssets=new Set(project.nodes.filter(node=>node.kind==='model'&&node.model).map(node=>node.model.assetId));
      const modelCache=new Map();
      const loader=new GLTFLoader();
      await Promise.all(project.assets.filter(asset=>referencedAssets.has(asset.id)).map(async asset=>{
        const source=embeddedAssets[asset.id];
        if(!source) throw new Error('Missing embedded model: '+asset.name);
        modelCache.set(asset.id,await loader.loadAsync(source));
      }));
      const objects=new Map();
      const makeGeometry=(kind)=>({box:()=>new THREE.BoxGeometry(),sphere:()=>new THREE.SphereGeometry(.5,40,24),capsule:()=>new THREE.CapsuleGeometry(.5,1,8,24),cylinder:()=>new THREE.CylinderGeometry(.5,.5,1,32),cone:()=>new THREE.ConeGeometry(.55,1,32),plane:()=>new THREE.PlaneGeometry(1,1),torus:()=>new THREE.TorusGeometry(.6,.12,18,48)}[kind]());
      for(const node of project.nodes){
        const root=new THREE.Group(); root.name=node.name; root.userData.node=node; root.userData.move=[0,0,0]; objects.set(node.id,root);
        if(node.kind==='mesh'){
          const m=node.material; const mat=new THREE.MeshStandardMaterial({color:m.color,roughness:m.roughness,metalness:m.metalness,emissive:m.emissive,emissiveIntensity:m.emissiveIntensity});
          const mesh=new THREE.Mesh(makeGeometry(node.primitive),mat); mesh.castShadow=!!node.castShadow; mesh.receiveShadow=!!node.receiveShadow; root.add(mesh);
        }
        if(node.kind==='model'&&node.model){
          const asset=project.assets.find(entry=>entry.id===node.model.assetId); const loaded=modelCache.get(node.model.assetId);
          if(asset&&loaded){
            const instance=cloneSkeleton(loaded.scene); instance.traverse(child=>{if(child.isMesh){child.castShadow=!!node.castShadow;child.receiveShadow=!!node.receiveShadow}});
            const host=new THREE.Group(); host.add(instance);
            if(node.model.fitMode==='fit'){
              const bounds=asset.diagnostics.bounds; const largest=Math.max(...bounds.size,.0001); const scale=node.model.targetSize/largest;
              host.scale.setScalar(scale); host.position.set(-bounds.center[0]*scale,-bounds.min[1]*scale,-bounds.center[2]*scale);
            }
            root.add(host);
          }
        }
        if(node.kind==='light'){
          const l=node.light; let light;
          if(l.type==='directional') light=new THREE.DirectionalLight(l.color,l.intensity); else if(l.type==='spot') light=new THREE.SpotLight(l.color,l.intensity,l.distance,Math.PI/5,.35,1.4); else light=new THREE.PointLight(l.color,l.intensity,l.distance,2);
          light.castShadow=l.castShadow; root.add(light);
        }
        if(node.kind==='camera'){
          const c=node.camera; const cam=new THREE.PerspectiveCamera(c.fov,innerWidth/innerHeight,c.near,c.far); cam.userData.primary=c.primary; root.add(cam);
        }
        root.position.fromArray(node.transform.position); root.rotation.fromArray([...node.transform.rotation,'XYZ']); root.scale.fromArray(node.transform.scale); root.visible=node.visible;
      }
      for(const node of project.nodes){const object=objects.get(node.id);const parent=node.parentId?objects.get(node.parentId):scene;parent.add(object)}
      let camera;
      for(const root of objects.values()){const candidate=root.children.find(child=>child.isPerspectiveCamera&&child.userData.primary);if(candidate){camera=candidate;break}}
      if(!camera){camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.1,200);camera.position.set(9,6.5,11);camera.lookAt(0,1,0)}
      camera.updateMatrixWorld(true);
      const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.target.set(0,1.2,0);
      const clock=new THREE.Clock();
      const keys=new Set();const moveKeys=new Set(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright']);
      addEventListener('keydown',event=>{const key=event.key.toLowerCase();if(moveKeys.has(key)){keys.add(key);event.preventDefault()}});
      addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));addEventListener('blur',()=>keys.clear());
      function frame(){requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),.05);const t=clock.elapsedTime;for(const root of objects.values()){const node=root.userData.node;const move=root.userData.move;for(const component of node.components){if(!component.enabled||component.type!=='keyboardMove')continue;let horizontal=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0);let vertical=(keys.has('w')||keys.has('arrowup')?1:0)-(keys.has('s')||keys.has('arrowdown')?1:0);const length=Math.hypot(horizontal,vertical)||1;horizontal/=length;vertical/=length;move[0]+=horizontal*component.speed*dt;if(component.plane==='xy')move[1]+=vertical*component.speed*dt;else move[2]-=vertical*component.speed*dt}root.position.fromArray(node.transform.position);root.position.x+=move[0];root.position.y+=move[1];root.position.z+=move[2];root.rotation.fromArray([...node.transform.rotation,'XYZ']);root.scale.fromArray(node.transform.scale);for(const component of node.components){if(!component.enabled)continue;if(component.type==='rotate')root.rotation[component.axis]+=t*component.speed;else if(component.type==='float')root.position[component.axis]+=Math.sin(t*component.speed*2+component.phase)*component.distance}}controls.update();renderer.render(scene,camera)}
      addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});frame();
    }
    boot().catch(error=>{document.querySelector('.badge').textContent='Build could not start · '+error.message;console.error(error)});
  </script>
</body>
</html>`;
}
