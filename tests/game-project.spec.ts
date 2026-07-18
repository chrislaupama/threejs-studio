import { expect, test } from '@playwright/test';
import {
  createLegacySceneView,
  loadGameProjectDocument,
  syncLegacySceneToV5,
} from '../src/editor/gameProject';
import { createStarterProject } from '../src/editor/project';
import { validateProjectDocumentV5 } from '../src/editor/projectV5';
import type { DataAssetRecordV5 } from '../src/editor/types';

test('game project loader makes schema v5 authoritative and preserves legacy ids', () => {
  const legacy = createStarterProject();
  const loaded = loadGameProjectDocument(legacy);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  expect(loaded.migratedFrom).toBe(4);
  expect(loaded.project.schemaVersion).toBe(5);
  expect(loaded.project.entities.map((entity) => entity.id)).toEqual(legacy.nodes.map((node) => node.id));
  expect(createLegacySceneView(loaded.project)).toEqual(legacy);
});

test('legacy scene commits retain future v5 data and device bindings', () => {
  const loaded = loadGameProjectDocument(createStarterProject());
  if (!loaded.ok) throw new Error(loaded.errors.join(' '));
  const project = structuredClone(loaded.project);
  const dataAsset: DataAssetRecordV5 = {
    assetVersion: 1,
    id: 'asset.game-rules',
    kind: 'data',
    name: 'Game Rules',
    revision: 1,
    createdAt: project.updatedAt,
    updatedAt: project.updatedAt,
    tags: ['runtime'],
    value: { targetScore: 5 },
  };
  project.assets.push(dataAsset);
  project.inputMaps[0]!.actions[0]!.bindings.push({
    id: 'binding.touch.move-x',
    device: 'touch',
    control: 'move-stick',
    axis: 'x',
    scale: 1,
  });
  const view = createLegacySceneView(project);
  view.name = 'Updated title';
  view.nodes.find((node) => node.id === 'player-core')!.name = 'Hero';

  const synced = syncLegacySceneToV5(project, view);
  expect(synced.name).toBe('Updated title');
  expect(synced.entities.find((entity) => entity.id === 'player-core')?.name).toBe('Hero');
  expect(synced.assets.find((asset) => asset.id === dataAsset.id)).toEqual(dataAsset);
  expect(synced.inputMaps[0]!.actions[0]!.bindings).toContainEqual(expect.objectContaining({ device: 'touch' }));
  expect(validateProjectDocumentV5(synced).ok).toBe(true);
});

test('malformed schema v5 projects fail closed instead of falling through legacy migration', () => {
  const loaded = loadGameProjectDocument({ schemaVersion: 5, id: 'broken' });
  expect(loaded).toMatchObject({ ok: false });
  if (!loaded.ok) expect(loaded.errors.length).toBeGreaterThan(2);
});
