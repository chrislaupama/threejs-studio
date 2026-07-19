import { expect, test } from '@playwright/test';
import {
  createLegacySceneView,
  loadGameProjectDocument,
  syncLegacySceneToV5,
} from '../src/editor/gameProject';
import { createStarterProject } from '../src/editor/project';
import { validateProjectDocumentV5 } from '../src/editor/projectV5';
import type { DataAssetRecordV5, InputActionV5 } from '../src/editor/types';

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

test('ordinary legacy edits preserve hidden v5 actions and merge only projected keyboard controls', () => {
  const loaded = loadGameProjectDocument(createStarterProject());
  if (!loaded.ok) throw new Error(loaded.errors.join(' '));
  const project = structuredClone(loaded.project);
  const inputMap = project.inputMaps[0]!;
  const move = inputMap.actions.find((action) => action.id === 'player.move')!;
  move.deadZone = 0.28;
  move.bindings.splice(1, 0,
    { id: 'binding.move.pointer-x', device: 'pointer', control: 'deltaX', scale: 0.25 },
    { id: 'binding.move.gamepad-x', device: 'gamepad', control: 'axis.0', gamepadIndex: 1, axis: 'x', scale: 0.75 },
  );
  move.bindings.push({
    id: 'binding.move.touch-y',
    device: 'touch',
    control: 'joystick.y',
    axis: 'y',
    scale: -0.8,
  });
  const interact: InputActionV5 = {
    id: 'player.interact',
    name: 'Interact',
    type: 'button',
    deadZone: 0,
    bindings: [
      { id: 'binding.interact.keyboard', device: 'keyboard', code: 'KeyE' },
      { id: 'binding.interact.pointer', device: 'pointer', control: 'primary' },
    ],
  };
  const throttle: InputActionV5 = {
    id: 'player.throttle',
    name: 'Throttle',
    type: 'axis1d',
    deadZone: 0.12,
    bindings: [
      { id: 'binding.throttle.keyboard', device: 'keyboard', code: 'ShiftLeft' },
      { id: 'binding.throttle.gamepad', device: 'gamepad', control: 'axis.2', gamepadIndex: 0, scale: 0.5 },
    ],
  };
  inputMap.actions = [interact, move, throttle];

  const hiddenBefore = inputMap.actions
    .filter((action) => action.type !== 'axis2d')
    .map((action) => JSON.stringify(action));
  const nonKeyboardBefore = structuredClone(move.bindings.filter((binding) => binding.device !== 'keyboard'));
  const view = createLegacySceneView(project);
  view.nodes.find((node) => node.id === 'player-core')!.name = 'Human-edited player';
  const projectedMove = view.inputActions.find((action) => action.id === move.id)!;
  projectedMove.name = 'Move remapped';
  projectedMove.bindings = [
    ...projectedMove.bindings.slice(1),
    { ...projectedMove.bindings[0]!, code: 'KeyQ' },
  ];

  const synced = syncLegacySceneToV5(project, view);
  const syncedMap = synced.inputMaps[0]!;
  const syncedMove = syncedMap.actions.find((action) => action.id === move.id)!;
  expect(synced.entities.find((entity) => entity.id === 'player-core')?.name).toBe('Human-edited player');
  expect(syncedMap.actions
    .filter((action) => action.type !== 'axis2d')
    .map((action) => JSON.stringify(action))).toEqual(hiddenBefore);
  expect(syncedMove).toMatchObject({ name: 'Move remapped', type: 'axis2d', deadZone: 0.28 });
  expect(syncedMove.bindings.filter((binding) => binding.device !== 'keyboard')).toEqual(nonKeyboardBefore);
  expect(syncedMove.bindings
    .filter((binding) => binding.device === 'keyboard')
    .map(({ id, code, axis, scale }) => ({ id, code, axis, scale }))).toEqual(projectedMove.bindings);
  expect(validateProjectDocumentV5(synced)).toMatchObject({ ok: true });
});

test('legacy input ids cannot overwrite non-projectable v5 actions', () => {
  const loaded = loadGameProjectDocument(createStarterProject());
  if (!loaded.ok) throw new Error(loaded.errors.join(' '));
  const project = structuredClone(loaded.project);
  project.inputMaps[0]!.actions.unshift({
    id: 'player.interact',
    name: 'Interact',
    type: 'button',
    deadZone: 0,
    bindings: [{ id: 'binding.interact.keyboard', device: 'keyboard', code: 'KeyE' }],
  });
  const view = createLegacySceneView(project);
  view.inputActions[0]!.id = 'player.interact';

  expect(() => syncLegacySceneToV5(project, view)).toThrow(
    'Legacy Input Action "player.interact" conflicts with a non-projectable v5 action.',
  );
  expect(project.inputMaps[0]!.actions[0]).toEqual(expect.objectContaining({
    id: 'player.interact',
    type: 'button',
  }));
});

test('deleting a projected axis2d action leaves hidden action types intact', () => {
  const loaded = loadGameProjectDocument(createStarterProject());
  if (!loaded.ok) throw new Error(loaded.errors.join(' '));
  const project = structuredClone(loaded.project);
  const hidden: InputActionV5[] = [
    {
      id: 'player.jump',
      name: 'Jump',
      type: 'button',
      deadZone: 0,
      bindings: [{ id: 'binding.jump.keyboard', device: 'keyboard', code: 'Space' }],
    },
    {
      id: 'player.zoom',
      name: 'Zoom',
      type: 'axis1d',
      deadZone: 0.2,
      bindings: [{ id: 'binding.zoom.pointer', device: 'pointer', control: 'wheel', scale: -0.1 }],
    },
  ];
  project.inputMaps[0]!.actions.push({
    id: 'player.look',
    name: 'Look',
    type: 'axis2d',
    deadZone: 0.1,
    bindings: [{ id: 'binding.look.keyboard', device: 'keyboard', code: 'KeyL', axis: 'x', scale: 1 }],
  }, ...structuredClone(hidden));
  const view = createLegacySceneView(project);
  view.inputActions = view.inputActions.filter((action) => action.id !== 'player.look');

  const synced = syncLegacySceneToV5(project, view);
  expect(synced.inputMaps[0]!.actions.map((action) => action.id)).toEqual([
    'player.move',
    'player.jump',
    'player.zoom',
  ]);
  expect(synced.inputMaps[0]!.actions.slice(1)).toEqual(hidden);
  expect(validateProjectDocumentV5(synced)).toMatchObject({ ok: true });
});

test('malformed schema v5 projects fail closed instead of falling through legacy migration', () => {
  const loaded = loadGameProjectDocument({ schemaVersion: 5, id: 'broken' });
  expect(loaded).toMatchObject({ ok: false });
  if (!loaded.ok) expect(loaded.errors.length).toBeGreaterThan(2);
});
