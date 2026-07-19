import { loadProjectDocument } from './project';
import {
  DEFAULT_V5_INPUT_MAP_ID,
  getStartupSceneV5,
  migrateProjectV4ToV5,
  validateProjectDocumentV5,
} from './projectV5';
import type {
  EntityV5,
  InputActionV5,
  InputMapV5,
  ModelAssetRecord,
  ModelAssetRecordV5,
  ProjectDocument,
  ProjectDocumentV5,
  SceneNode,
} from './types';

export type GameProjectLoadResult =
  | { ok: true; project: ProjectDocumentV5; migratedFrom: 1 | 2 | 3 | 4 | null; warnings: string[] }
  | { ok: false; errors: string[] };

const legacyEntityKinds = new Set<EntityV5['kind']>(['group', 'mesh', 'model', 'light', 'camera']);

function legacyNodeFromEntity(entity: EntityV5): SceneNode | null {
  if (!legacyEntityKinds.has(entity.kind)) return null;
  return {
    id: entity.id,
    name: entity.name,
    kind: entity.kind as SceneNode['kind'],
    parentId: entity.parentId,
    visible: entity.visible,
    locked: entity.locked,
    transform: structuredClone(entity.transform),
    ...(entity.primitive ? { primitive: entity.primitive } : {}),
    ...(entity.material ? { material: structuredClone(entity.material) } : {}),
    ...(entity.model ? { model: structuredClone(entity.model) } : {}),
    ...(entity.light ? { light: structuredClone(entity.light) } : {}),
    ...(entity.camera ? { camera: structuredClone(entity.camera) } : {}),
    components: structuredClone(entity.components),
    ...(entity.castShadow !== undefined ? { castShadow: entity.castShadow } : {}),
    ...(entity.receiveShadow !== undefined ? { receiveShadow: entity.receiveShadow } : {}),
  };
}

function legacyAssetFromV5(asset: ModelAssetRecordV5): ModelAssetRecord {
  return {
    id: asset.id,
    kind: 'model',
    name: asset.name,
    sourceFilename: asset.source.filename,
    mimeType: asset.source.mimeType,
    byteLength: asset.source.byteLength,
    revision: asset.revision,
    importedAt: asset.createdAt,
    diagnostics: structuredClone(asset.diagnostics),
  };
}

function legacyActionFromV5(action: InputActionV5): ProjectDocument['inputActions'][number] | null {
  if (action.type !== 'axis2d') return null;
  const bindings = action.bindings.flatMap((binding) => {
    if (binding.device !== 'keyboard' || !binding.axis || !binding.scale) return [];
    return [{
      id: binding.id,
      code: binding.code,
      axis: binding.axis,
      scale: binding.scale,
    }];
  });
  return { id: action.id, name: action.name, type: 'axis2d', bindings };
}

/**
 * Load any supported project revision into the authoritative v5 contract.
 * Older documents pass through their existing strict loader before migration.
 */
export function loadGameProjectDocument(value: unknown): GameProjectLoadResult {
  if (typeof value === 'object' && value !== null && 'schemaVersion' in value && value.schemaVersion === 5) {
    const validated = validateProjectDocumentV5(value);
    return validated.ok
      ? { ok: true, project: validated.project, migratedFrom: null, warnings: validated.warnings }
      : validated;
  }

  const legacyVersion = typeof value === 'object' && value !== null && 'schemaVersion' in value &&
    typeof value.schemaVersion === 'number' && [1, 2, 3, 4].includes(value.schemaVersion)
    ? value.schemaVersion as 1 | 2 | 3 | 4
    : null;
  const loaded = loadProjectDocument(value);
  if (!loaded.ok) return loaded;
  try {
    return {
      ok: true,
      project: migrateProjectV4ToV5(loaded.project),
      migratedFrom: legacyVersion ?? 4,
      warnings: legacyVersion === 4 ? [] : [`Migrated project schema v${legacyVersion ?? 'legacy'} to v5.`],
    };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : 'The project could not be migrated to v5.'] };
  }
}

/**
 * Compatibility projection used while legacy panels are migrated. It is a
 * disposable view: durable writes must flow back through syncLegacySceneToV5.
 */
export function createLegacySceneView(project: ProjectDocumentV5, sceneId = project.startupSceneId): ProjectDocument {
  const scene = project.scenes.find((entry) => entry.id === sceneId) ?? getStartupSceneV5(project);
  if (!scene) throw new Error(`Scene "${sceneId}" does not exist.`);
  const inputMap = project.inputMaps.find((entry) => entry.id === DEFAULT_V5_INPUT_MAP_ID) ?? project.inputMaps[0];
  return {
    schemaVersion: 4,
    id: project.id,
    name: project.name,
    sceneName: scene.name,
    updatedAt: project.updatedAt,
    settings: structuredClone(scene.settings),
    assets: project.assets.filter((asset): asset is ModelAssetRecordV5 => asset.kind === 'model').map(legacyAssetFromV5),
    inputActions: (inputMap?.actions ?? []).flatMap((action) => {
      const legacy = legacyActionFromV5(action);
      return legacy ? [legacy] : [];
    }),
    nodes: project.entities
      .filter((entity) => entity.sceneId === scene.id)
      .flatMap((entity) => {
        const node = legacyNodeFromEntity(entity);
        return node ? [node] : [];
      }),
  };
}

function mergeInputBindings(
  action: ProjectDocument['inputActions'][number],
  previous?: InputActionV5,
): InputActionV5['bindings'] {
  const keyboardBindings: InputActionV5['bindings'] = action.bindings.map((binding) => ({
    ...structuredClone(binding),
    device: 'keyboard' as const,
  }));
  if (!previous) return keyboardBindings;

  let lastKeyboardIndex = -1;
  for (let index = previous.bindings.length - 1; index >= 0; index -= 1) {
    if (previous.bindings[index]?.device === 'keyboard') {
      lastKeyboardIndex = index;
      break;
    }
  }
  if (lastKeyboardIndex < 0) {
    return [
      ...keyboardBindings,
      ...structuredClone(previous.bindings),
    ];
  }

  let keyboardIndex = 0;
  const bindings: InputActionV5['bindings'] = [];
  previous.bindings.forEach((binding, index) => {
    if (binding.device === 'keyboard') {
      const replacement = keyboardBindings[keyboardIndex];
      if (replacement) bindings.push(replacement);
      keyboardIndex += 1;
      if (index === lastKeyboardIndex) bindings.push(...keyboardBindings.slice(keyboardIndex));
      return;
    }
    bindings.push(structuredClone(binding));
  });
  return bindings;
}

function mergeInputAction(action: ProjectDocument['inputActions'][number], previous?: InputActionV5): InputActionV5 {
  const preserved = previous?.type === 'axis2d' ? structuredClone(previous) : undefined;
  return {
    ...preserved,
    id: action.id,
    name: action.name,
    type: action.type,
    deadZone: preserved?.deadZone ?? 0,
    bindings: mergeInputBindings(action, preserved),
  };
}

function mergeInputActions(
  previous: InputActionV5[],
  legacy: ProjectDocument['inputActions'],
): InputActionV5[] {
  const hiddenActionIds = new Set(previous
    .filter((action) => action.type !== 'axis2d')
    .map((action) => action.id));
  const hiddenCollision = legacy.find((action) => hiddenActionIds.has(action.id));
  if (hiddenCollision) {
    throw new Error(
      `Legacy Input Action "${hiddenCollision.id}" conflicts with a non-projectable v5 action.`,
    );
  }

  const legacyById = new Map(legacy.map((action) => [action.id, action]));
  const previousIds = new Set(previous.map((action) => action.id));
  return [
    ...previous.flatMap((action) => {
      if (action.type !== 'axis2d') return [structuredClone(action)];
      const projected = legacyById.get(action.id);
      return projected ? [mergeInputAction(projected, action)] : [];
    }),
    ...legacy
      .filter((action) => !previousIds.has(action.id))
      .map((action) => mergeInputAction(action)),
  ];
}

function mergeEntity(node: SceneNode, sceneId: string, previous?: EntityV5): EntityV5 {
  return {
    id: node.id,
    sceneId,
    name: node.name,
    kind: node.kind,
    parentId: node.parentId,
    active: previous?.active ?? true,
    visible: node.visible,
    locked: node.locked,
    tags: structuredClone(previous?.tags ?? []),
    layers: structuredClone(previous?.layers ?? ['layer.default']),
    transform: structuredClone(node.transform),
    ...(node.primitive ? { primitive: node.primitive } : {}),
    ...(node.material ? { material: structuredClone(node.material) } : {}),
    ...(node.model ? { model: structuredClone(node.model) } : {}),
    ...(node.light ? { light: structuredClone(node.light) } : {}),
    ...(node.camera ? { camera: structuredClone(node.camera) } : {}),
    components: structuredClone(node.components),
    ...(node.castShadow !== undefined ? { castShadow: node.castShadow } : {}),
    ...(node.receiveShadow !== undefined ? { receiveShadow: node.receiveShadow } : {}),
  };
}

function mergeModelAsset(asset: ModelAssetRecord, previous?: ModelAssetRecordV5): ModelAssetRecordV5 {
  return {
    assetVersion: 1,
    id: asset.id,
    kind: 'model',
    name: asset.name,
    revision: asset.revision,
    createdAt: previous?.createdAt ?? asset.importedAt,
    updatedAt: asset.importedAt,
    tags: structuredClone(previous?.tags ?? []),
    source: {
      filename: asset.sourceFilename,
      mimeType: asset.mimeType,
      byteLength: asset.byteLength,
      ...(previous?.source.contentHash ? { contentHash: previous.source.contentHash } : {}),
    },
    diagnostics: structuredClone(asset.diagnostics),
  };
}

/**
 * Apply a legacy editor view back into one v5 scene without discarding other
 * scenes, non-model assets, non-keyboard bindings, prefabs, UI, or settings.
 */
export function syncLegacySceneToV5(
  project: ProjectDocumentV5,
  legacy: ProjectDocument,
  sceneId = project.startupSceneId,
): ProjectDocumentV5 {
  if (legacy.id !== project.id) throw new Error('The legacy scene belongs to a different project.');
  const sceneIndex = project.scenes.findIndex((entry) => entry.id === sceneId);
  if (sceneIndex < 0) throw new Error(`Scene "${sceneId}" does not exist.`);

  const next = structuredClone(project);
  const previousEntities = new Map(next.entities.map((entity) => [entity.id, entity]));
  const legacyIds = new Set(legacy.nodes.map((node) => node.id));
  next.entities = [
    ...next.entities.filter((entity) => entity.sceneId !== sceneId || !legacyEntityKinds.has(entity.kind)),
    ...next.entities.filter((entity) => entity.sceneId === sceneId && legacyEntityKinds.has(entity.kind) && !legacyIds.has(entity.id) && !legacyNodeFromEntity(entity)),
    ...legacy.nodes.map((node) => mergeEntity(node, sceneId, previousEntities.get(node.id))),
  ];

  const scene = next.scenes[sceneIndex]!;
  scene.name = legacy.sceneName;
  scene.settings = structuredClone(legacy.settings);
  scene.rootEntityIds = next.entities.filter((entity) => entity.sceneId === sceneId && entity.parentId === null).map((entity) => entity.id);

  const previousModels = new Map(next.assets.filter((asset): asset is ModelAssetRecordV5 => asset.kind === 'model').map((asset) => [asset.id, asset]));
  next.assets = [
    ...next.assets.filter((asset) => asset.kind !== 'model'),
    ...legacy.assets.map((asset) => mergeModelAsset(asset, previousModels.get(asset.id))),
  ];

  const inputMapIndex = next.inputMaps.findIndex((entry) => entry.id === DEFAULT_V5_INPUT_MAP_ID);
  const resolvedIndex = inputMapIndex >= 0 ? inputMapIndex : 0;
  const currentMap: InputMapV5 = next.inputMaps[resolvedIndex] ?? {
    id: DEFAULT_V5_INPUT_MAP_ID,
    name: 'Default',
    version: 1,
    enabled: true,
    priority: 0,
    actions: [],
  };
  currentMap.actions = mergeInputActions(currentMap.actions, legacy.inputActions);
  if (next.inputMaps.length) next.inputMaps[resolvedIndex] = currentMap;
  else next.inputMaps.push(currentMap);

  next.name = legacy.name;
  next.updatedAt = legacy.updatedAt;
  const validation = validateProjectDocumentV5(next);
  if (!validation.ok) throw new Error(`The v5 project update was rejected: ${validation.errors.join(' ')}`);
  return validation.project;
}
