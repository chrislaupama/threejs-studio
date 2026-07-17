import { expect, test } from '@playwright/test';
import { addModelAsset, buildRuntimeHtml, createGameplayComponent, createStarterProject, loadProjectDocument } from '../src/editor/project';
import type { ModelAssetRecord } from '../src/editor/types';

test('v1, v2, and v3 projects migrate once into stable v4 projects', () => {
  const starter = createStarterProject();
  const legacy = structuredClone(starter) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 1;
  const settings = legacy.settings as Record<string, unknown>;
  delete settings.fogEnabled;
  delete settings.exposure;
  const nodes = legacy.nodes as Array<Record<string, unknown>>;
  for (const node of nodes) delete node.components;
  nodes.find((node) => node.id === 'player-core')!.behavior = {
    type: 'float',
    enabled: true,
    speed: 1.25,
    amplitude: 0.12,
  };

  const first = loadProjectDocument(legacy);
  expect(first.ok).toBeTruthy();
  if (!first.ok) return;
  expect(first.project.schemaVersion).toBe(4);
  expect(first.project.assets).toEqual([]);
  expect(first.project.inputActions).toEqual([
    expect.objectContaining({ id: 'player.move', name: 'Move', type: 'axis2d' }),
  ]);
  expect(first.project.settings.fogEnabled).toBe(true);
  expect(first.project.nodes.find((node) => node.id === 'player-core')?.components).toEqual([
    {
      id: 'legacy-player-core-float',
      type: 'float',
      enabled: true,
      speed: 1.25,
      distance: 0.12,
      axis: 'y',
      phase: 0,
    },
  ]);

  const second = loadProjectDocument(first.project);
  expect(second.ok).toBeTruthy();
  if (!second.ok) return;
  expect(second.project.nodes.find((node) => node.id === 'player-core')?.components).toEqual(
    first.project.nodes.find((node) => node.id === 'player-core')?.components,
  );

  const versionTwo = structuredClone(starter) as unknown as Record<string, unknown>;
  versionTwo.schemaVersion = 2;
  delete versionTwo.assets;
  const versionTwoResult = loadProjectDocument(versionTwo);
  expect(versionTwoResult.ok).toBeTruthy();
  if (versionTwoResult.ok) {
    expect(versionTwoResult.project.schemaVersion).toBe(4);
    expect(versionTwoResult.project.assets).toEqual([]);
    expect(versionTwoResult.project.inputActions[0]?.id).toBe('player.move');
  }

  const versionThree = structuredClone(starter) as unknown as Record<string, unknown>;
  versionThree.schemaVersion = 3;
  delete versionThree.inputActions;
  const versionThreeNodes = versionThree.nodes as Array<Record<string, unknown>>;
  const legacyMove = (versionThreeNodes.find((node) => node.id === 'player-rig')?.components as Array<Record<string, unknown>>)[0];
  delete legacyMove.actionId;
  const versionThreeResult = loadProjectDocument(versionThree);
  expect(versionThreeResult.ok).toBeTruthy();
  if (versionThreeResult.ok) {
    expect(versionThreeResult.project.schemaVersion).toBe(4);
    expect(versionThreeResult.project.inputActions[0]?.id).toBe('player.move');
    expect(versionThreeResult.project.nodes.find((node) => node.id === 'player-rig')?.components[0]).toMatchObject({
      type: 'keyboardMove',
      actionId: 'player.move',
    });
  }
});

test('project loading rejects future schemas and reports exact nested paths', () => {
  const future = { ...createStarterProject(), schemaVersion: 5 };
  const futureResult = loadProjectDocument(future);
  expect(futureResult.ok).toBe(false);
  if (!futureResult.ok) expect(futureResult.errors[0]).toContain('newer than this editor supports');

  const malformed = createStarterProject() as unknown as Record<string, unknown>;
  const nodes = malformed.nodes as Array<Record<string, unknown>>;
  const player = nodes.find((node) => node.id === 'player-core')!;
  const components = player.components as Array<Record<string, unknown>>;
  components[0].speed = 'fast';
  const malformedResult = loadProjectDocument(malformed);
  expect(malformedResult.ok).toBe(false);
  if (!malformedResult.ok) expect(malformedResult.errors).toContain('nodes[8].components[0].speed must be a finite number.');

  const cyclic = createStarterProject();
  cyclic.nodes.find((node) => node.id === 'environment')!.parentId = 'ground';
  const cyclicResult = loadProjectDocument(cyclic);
  expect(cyclicResult.ok).toBe(false);
  if (!cyclicResult.ok) expect(cyclicResult.errors.some((error) => error.includes('hierarchy cycle'))).toBe(true);
});

test('model assets validate references and standalone builds embed their source', () => {
  const asset: ModelAssetRecord = {
    id: 'asset-triangle',
    kind: 'model',
    name: 'Triangle',
    sourceFilename: 'triangle.glb',
    mimeType: 'model/gltf-binary',
    byteLength: 996,
    revision: 1,
    importedAt: '2026-07-17T00:00:00.000Z',
    diagnostics: {
      meshes: 1,
      triangles: 1,
      materials: 1,
      textures: 0,
      animationNames: [],
      bounds: { min: [-0.5, 0, 0], max: [0.5, 1, 0], size: [1, 1, 0], center: [0, 0.5, 0] },
      warnings: [],
    },
  };
  const withAsset = addModelAsset(createStarterProject(), asset);
  const loaded = loadProjectDocument(withAsset.project);
  expect(loaded.ok).toBeTruthy();

  const duplicate = structuredClone(withAsset.project);
  duplicate.assets.push(structuredClone(asset));
  const duplicateResult = loadProjectDocument(duplicate);
  expect(duplicateResult.ok).toBe(false);
  if (!duplicateResult.ok) expect(duplicateResult.errors).toContain('assets[1].id duplicates asset id "asset-triangle".');

  const dangling = structuredClone(withAsset.project);
  dangling.nodes.find((node) => node.kind === 'model')!.model!.assetId = 'missing-asset';
  const danglingResult = loadProjectDocument(dangling);
  expect(danglingResult.ok).toBe(false);
  if (!danglingResult.ok) expect(danglingResult.errors.some((error) => error.includes('.model.assetId references missing asset'))).toBe(true);

  const html = buildRuntimeHtml(withAsset.project, { [asset.id]: 'data:model/gltf-binary;base64,AAAA' });
  expect(html).toContain(asset.id);
  expect(html).toContain('data:model/gltf-binary;base64,AAAA');
  expect(html).toContain('GLTFLoader');
  expect(html).toContain('cloneSkeleton');
});

test('component presets are safe, unique, and composable', () => {
  const rotate = createGameplayComponent('rotate');
  const float = createGameplayComponent('float');
  const move = createGameplayComponent('keyboardMove');
  expect(new Set([rotate.id, float.id, move.id]).size).toBe(3);
  expect(rotate).toMatchObject({ type: 'rotate', enabled: true, axis: 'y' });
  expect(float).toMatchObject({ type: 'float', enabled: true, axis: 'y', distance: 0.25 });
  expect(move).toMatchObject({ type: 'keyboardMove', enabled: true, plane: 'xz', actionId: 'player.move' });
});
