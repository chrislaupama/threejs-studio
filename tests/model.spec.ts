import { expect, test } from '@playwright/test';
import { createGameplayComponent, createStarterProject, loadProjectDocument } from '../src/editor/project';

test('v1 projects migrate once into stable v2 gameplay components', () => {
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
  expect(first.project.schemaVersion).toBe(2);
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
});

test('project loading rejects future schemas and reports exact nested paths', () => {
  const future = { ...createStarterProject(), schemaVersion: 3 };
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

test('component presets are safe, unique, and composable', () => {
  const rotate = createGameplayComponent('rotate');
  const float = createGameplayComponent('float');
  const move = createGameplayComponent('keyboardMove');
  expect(new Set([rotate.id, float.id, move.id]).size).toBe(3);
  expect(rotate).toMatchObject({ type: 'rotate', enabled: true, axis: 'y' });
  expect(float).toMatchObject({ type: 'float', enabled: true, axis: 'y', distance: 0.25 });
  expect(move).toMatchObject({ type: 'keyboardMove', enabled: true, plane: 'xz' });
});
