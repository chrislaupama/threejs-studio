import { expect, test } from '@playwright/test';
import {
  DEFAULT_V5_BUILD_PROFILE_ID,
  DEFAULT_V5_INPUT_MAP_ID,
  DEFAULT_V5_LAYER_ID,
  DEFAULT_V5_SCENE_ID,
  getActiveSceneEntitiesV5,
  getActiveSceneV5,
  getEntitiesForSceneV5,
  isEntityEffectivelyActiveV5,
  migrateProjectV4ToV5,
  validateProjectDocumentV5,
} from '../src/editor/projectV5';
import { addModelAsset, createStarterProject } from '../src/editor/project';
import type {
  AnimationAssetRecordV5,
  MaterialAssetRecordV5,
  ModelAssetRecord,
  PrefabRecordV5,
  TextureAssetRecordV5,
  UIDocumentV5,
} from '../src/editor/types';

function modelAsset(): ModelAssetRecord {
  return {
    id: 'asset-hero',
    kind: 'model',
    name: 'Hero',
    sourceFilename: 'hero.glb',
    mimeType: 'model/gltf-binary',
    byteLength: 2048,
    revision: 3,
    importedAt: '2026-07-18T01:02:03.000Z',
    diagnostics: {
      meshes: 2,
      triangles: 128,
      materials: 1,
      textures: 1,
      animationNames: ['Idle'],
      bounds: { min: [-0.5, 0, -0.5], max: [0.5, 2, 0.5], size: [1, 2, 1], center: [0, 1, 0] },
      warnings: [],
    },
  };
}

test('v4 migration is deterministic and preserves every durable identifier', () => {
  const original = addModelAsset(createStarterProject(), modelAsset()).project;
  const first = migrateProjectV4ToV5(original);
  const second = migrateProjectV4ToV5(structuredClone(original));

  expect(first).toEqual(second);
  expect(first.schemaVersion).toBe(5);
  expect(first.id).toBe(original.id);
  expect(first.updatedAt).toBe(original.updatedAt);
  expect(first.startupSceneId).toBe(DEFAULT_V5_SCENE_ID);
  expect(first.scenes).toEqual([
    expect.objectContaining({
      id: DEFAULT_V5_SCENE_ID,
      name: original.sceneName,
      rootEntityIds: original.nodes.filter((node) => node.parentId === null).map((node) => node.id),
      settings: original.settings,
    }),
  ]);
  expect(first.entities.map((entity) => entity.id)).toEqual(original.nodes.map((node) => node.id));
  expect(first.entities.every((entity) => entity.sceneId === DEFAULT_V5_SCENE_ID && entity.active)).toBe(true);
  expect(first.entities.every((entity) => entity.layers[0] === DEFAULT_V5_LAYER_ID)).toBe(true);
  expect(first.assets[0]).toMatchObject({
    id: 'asset-hero',
    kind: 'model',
    assetVersion: 1,
    revision: 3,
    source: { filename: 'hero.glb', mimeType: 'model/gltf-binary', byteLength: 2048 },
  });
  expect(first.inputMaps).toEqual([
    expect.objectContaining({
      id: DEFAULT_V5_INPUT_MAP_ID,
      actions: original.inputActions.map((action) => expect.objectContaining({
        id: action.id,
        bindings: action.bindings.map((binding) => expect.objectContaining({ id: binding.id, device: 'keyboard' })),
      })),
    }),
  ]);
  expect(first.defaultBuildProfileId).toBe(DEFAULT_V5_BUILD_PROFILE_ID);
  expect(first.prefabs).toEqual([]);
  expect(first.variables).toEqual([]);
  expect(first.events).toEqual([]);
  expect(first.ui).toEqual({ startupDocumentId: null, documents: [] });
  expect(first.permissions.network).toEqual({ policy: 'deny', origins: [] });
  expect(validateProjectDocumentV5(first)).toMatchObject({ ok: true, warnings: [] });
});

test('v5 validation enforces scene, layer, input, model, and hierarchy references', () => {
  const migrated = migrateProjectV4ToV5(createStarterProject());
  const invalid = structuredClone(migrated);
  invalid.startupSceneId = 'scene-missing';
  invalid.scenes[0]!.rootEntityIds = ['ground'];
  invalid.entities.find((entity) => entity.id === 'ground')!.layers = ['layer-missing'];
  invalid.entities.find((entity) => entity.id === 'player-rig')!.components[0] = {
    ...invalid.entities.find((entity) => entity.id === 'player-rig')!.components[0]!,
    actionId: 'action-missing',
  } as typeof invalid.entities[number]['components'][number];
  invalid.entities.find((entity) => entity.id === 'environment')!.parentId = 'ground';

  const result = validateProjectDocumentV5(invalid);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.errors.some((error) => error.includes('startupSceneId references missing scene'))).toBe(true);
  expect(result.errors.some((error) => error.includes('rootEntityIds must list every root entity'))).toBe(true);
  expect(result.errors.some((error) => error.includes('layers[0] references missing layer'))).toBe(true);
  expect(result.errors.some((error) => error.includes('actionId references missing input action'))).toBe(true);
  expect(result.errors.some((error) => error.includes('hierarchy cycle'))).toBe(true);
});

test('v5 union assets, prefabs, variables, events, and UI validate as serializable project data', () => {
  const project = migrateProjectV4ToV5(addModelAsset(createStarterProject(), modelAsset()).project);
  const texture: TextureAssetRecordV5 = {
    assetVersion: 1,
    id: 'texture-hero-color',
    kind: 'texture',
    name: 'Hero Color',
    revision: 1,
    createdAt: project.updatedAt,
    updatedAt: project.updatedAt,
    tags: ['character'],
    source: { filename: 'hero-color.webp', mimeType: 'image/webp', byteLength: 512 },
    colorSpace: 'srgb',
    usage: 'color',
    flipY: false,
  };
  const material: MaterialAssetRecordV5 = {
    assetVersion: 1,
    id: 'material-hero',
    kind: 'material',
    name: 'Hero Material',
    revision: 1,
    createdAt: project.updatedAt,
    updatedAt: project.updatedAt,
    tags: ['character'],
    material: {
      color: '#ffffff',
      emissive: '#000000',
      emissiveIntensity: 0,
      metalness: 0,
      roughness: 0.5,
      opacity: 1,
      transparent: false,
      doubleSided: false,
    },
    textures: { baseColor: texture.id },
  };
  const animation: AnimationAssetRecordV5 = {
    assetVersion: 1,
    id: 'animation-hero-idle',
    kind: 'animation',
    name: 'Hero Idle',
    revision: 1,
    createdAt: project.updatedAt,
    updatedAt: project.updatedAt,
    tags: ['character'],
    modelAssetId: 'asset-hero',
    clipName: 'Idle',
    durationSeconds: 1.5,
  };
  project.assets.push(texture, material, animation);

  const prefab: PrefabRecordV5 = {
    id: 'prefab-pickup',
    name: 'Pickup',
    version: 1,
    rootEntityId: 'prefab-pickup-root',
    tags: ['collectible'],
    entities: [{
      id: 'prefab-pickup-root',
      sceneId: null,
      name: 'Pickup Root',
      kind: 'group',
      parentId: null,
      active: true,
      visible: true,
      locked: false,
      tags: ['collectible'],
      layers: [DEFAULT_V5_LAYER_ID],
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      components: [],
    }],
  };
  project.prefabs.push(prefab);
  project.entities.push({
    id: 'pickup-instance',
    sceneId: DEFAULT_V5_SCENE_ID,
    name: 'Pickup Instance',
    kind: 'prefab',
    parentId: 'scene-root',
    active: true,
    visible: true,
    locked: false,
    tags: ['collectible'],
    layers: [DEFAULT_V5_LAYER_ID],
    transform: { position: [2, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    components: [],
    prefab: { prefabId: prefab.id, prefabVersion: prefab.version, overrides: [] },
  });
  project.variables.push({ id: 'score', name: 'Score', type: 'number', scope: 'save', defaultValue: 0 });
  project.events.push({ id: 'pickup.collected', name: 'Pickup Collected', payload: [{ id: 'value', name: 'Value', type: 'number', required: true }] });
  const hud: UIDocumentV5 = {
    id: 'ui-hud',
    name: 'HUD',
    sceneId: DEFAULT_V5_SCENE_ID,
    rootElementIds: ['ui-hud-root'],
    elements: [{ id: 'ui-hud-root', parentId: null, type: 'container', name: 'HUD Root', active: true, properties: { anchor: 'stretch' } }],
  };
  project.ui = { startupDocumentId: hud.id, documents: [hud] };

  const result = validateProjectDocumentV5(project);
  expect(result.ok).toBe(true);
});

test('active-scene helpers fall back to startup and respect inactive ancestors', () => {
  const project = migrateProjectV4ToV5(createStarterProject());
  const environment = project.entities.find((entity) => entity.id === 'environment')!;
  environment.active = false;

  expect(getActiveSceneV5(project, 'scene-missing')?.id).toBe(DEFAULT_V5_SCENE_ID);
  expect(getEntitiesForSceneV5(project, DEFAULT_V5_SCENE_ID).length).toBe(project.entities.length);
  expect(isEntityEffectivelyActiveV5(project, 'environment')).toBe(false);
  expect(isEntityEffectivelyActiveV5(project, 'ground')).toBe(false);
  expect(isEntityEffectivelyActiveV5(project, 'player-core')).toBe(true);
  const activeIds = getActiveSceneEntitiesV5(project, undefined, { activeOnly: true }).map((entity) => entity.id);
  expect(activeIds).not.toContain('environment');
  expect(activeIds).not.toContain('ground');
  expect(activeIds).toContain('player-core');
});
