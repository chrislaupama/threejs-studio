import { expect, test } from '@playwright/test';
import * as ts from 'typescript';
import { validateGameplayEventDefinition } from '../src/gameplay/events';
import { validateInputActionMap } from '../src/gameplay/input';
import { validatePhysicsBodies } from '../src/gameplay/physics';
import { validateProjectDocumentV5 } from '../src/editor/projectV5';
import type { UIElement } from '../src/runtime-ui/types';
import { validateUIDocument } from '../src/runtime-ui/validation';
import {
  COLLECT_ESCAPE_BEHAVIOR_SOURCE,
  COLLECT_ESCAPE_BUILD_PROFILE_ID,
  COLLECT_ESCAPE_EVENT_DEFINITIONS,
  COLLECT_ESCAPE_INPUT_ACTION_MAP,
  COLLECT_ESCAPE_PHYSICS_BODIES,
  COLLECT_ESCAPE_PICKUP_IDS,
  COLLECT_ESCAPE_RUNTIME_MANIFEST,
  COLLECT_ESCAPE_RUNTIME_UI,
  COLLECT_ESCAPE_RUNTIME_UI_ASSET_ID,
  COLLECT_ESCAPE_SCRIPT_ASSET_ID,
  COLLECT_ESCAPE_SOURCE_MAP_ASSET_ID,
  createCollectEscapeProject,
  createCollectEscapeTemplate,
} from '../src/templates/collectEscape';

function flattenUI(element: UIElement): UIElement[] {
  if (element.type === 'screen' || element.type === 'stack' || element.type === 'panel') {
    return [element, ...element.children.flatMap(flattenUI)];
  }
  return [element];
}

test('Collect & Escape is a deterministic, valid ProjectDocumentV5', () => {
  const first = createCollectEscapeProject();
  const second = createCollectEscapeProject();

  expect(first).toEqual(second);
  expect(first).not.toBe(second);
  expect(validateProjectDocumentV5(first)).toMatchObject({ ok: true, warnings: [] });

  const entityIds = first.entities.map((entity) => entity.id);
  const componentIds = first.entities.flatMap((entity) => entity.components.map((component) => component.id));
  const assetIds = first.assets.map((asset) => asset.id);
  expect(new Set(entityIds).size).toBe(entityIds.length);
  expect(new Set(componentIds).size).toBe(componentIds.length);
  expect(new Set(assetIds).size).toBe(assetIds.length);
  expect(COLLECT_ESCAPE_PICKUP_IDS.every((id) => entityIds.includes(id))).toBe(true);

  first.name = 'Mutated clone';
  expect(createCollectEscapeProject().name).toBe('Collect & Escape');
});

test('template uses the production gameplay input, physics, collision, and event contracts', () => {
  expect(validateInputActionMap(COLLECT_ESCAPE_INPUT_ACTION_MAP)).toEqual([]);
  expect(validatePhysicsBodies(COLLECT_ESCAPE_PHYSICS_BODIES)).toEqual([]);
  expect(COLLECT_ESCAPE_EVENT_DEFINITIONS.flatMap((event) => validateGameplayEventDefinition(event))).toEqual([]);

  const move = COLLECT_ESCAPE_INPUT_ACTION_MAP.actions.find((action) => action.id === 'move');
  expect(new Set(move?.bindings.map((binding) => binding.device))).toEqual(
    new Set(['keyboard', 'gamepad', 'touch']),
  );
  expect(COLLECT_ESCAPE_INPUT_ACTION_MAP.actions.find((action) => action.id === 'interact')?.bindings)
    .toEqual(expect.arrayContaining([expect.objectContaining({ device: 'pointer' })]));

  const sensors = COLLECT_ESCAPE_PHYSICS_BODIES.flatMap((body) => body.colliders).filter((collider) => collider.sensor);
  expect(sensors).toHaveLength(6);
  expect(COLLECT_ESCAPE_PHYSICS_BODIES.find((body) => body.id === 'physics.player')).toMatchObject({
    type: 'kinematicPosition',
    ccd: true,
    colliders: [expect.objectContaining({ shape: expect.objectContaining({ type: 'capsule' }) })],
  });
  expect(COLLECT_ESCAPE_RUNTIME_MANIFEST.componentBindings).toEqual(expect.arrayContaining([
    expect.objectContaining({ entityId: 'entity.player', type: 'characterController' }),
    expect.objectContaining({ entityId: 'entity.game-controller', type: 'scriptBehavior', assetId: COLLECT_ESCAPE_SCRIPT_ASSET_ID }),
    expect.objectContaining({ entityId: 'entity.hud', type: 'runtimeUI', assetId: COLLECT_ESCAPE_RUNTIME_UI_ASSET_ID }),
  ]));
  expect(COLLECT_ESCAPE_RUNTIME_MANIFEST.fixedDeltaSeconds).toBeCloseTo(1 / 60, 10);
  expect(COLLECT_ESCAPE_RUNTIME_MANIFEST.maxCatchUpTicks).toBe(5);
});

test('runtime HUD is responsive, accessible, touch-capable, and contract-valid', () => {
  expect(validateUIDocument(COLLECT_ESCAPE_RUNTIME_UI)).toMatchObject({ ok: true });

  const elements = flattenUI(COLLECT_ESCAPE_RUNTIME_UI.root);
  expect(COLLECT_ESCAPE_RUNTIME_UI.breakpoints).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'mobile', maxWidth: 767 }),
    expect.objectContaining({ id: 'desktop', minWidth: 768 }),
  ]));
  expect(elements.find((element) => element.id === 'hud.timer')).toMatchObject({
    type: 'progress',
    maximum: 60,
    value: { type: 'variable', variableId: 'timeRemaining' },
  });
  expect(elements.find((element) => element.id === 'hud.status')).toMatchObject({
    type: 'panel',
    role: 'status',
    live: 'polite',
  });
  expect(elements.find((element) => element.id === 'hud.restart')).toMatchObject({
    type: 'button',
    ariaLabel: { type: 'literal', value: 'Restart Collect and Escape' },
  });

  const touchButtons = elements.filter((element) => element.id.startsWith('touch.'));
  expect(touchButtons).toHaveLength(4);
  expect(touchButtons.every((element) => element.type === 'button' && element.style?.minHeight === '56px')).toBe(true);
});

test('project includes editable TypeScript source, game state, restart, and offline production build data', () => {
  const template = createCollectEscapeTemplate();
  const { project } = template;
  const script = project.assets.find((asset) => asset.id === COLLECT_ESCAPE_SCRIPT_ASSET_ID);
  const sourceCatalog = project.assets.find((asset) => asset.id === COLLECT_ESCAPE_SOURCE_MAP_ASSET_ID);

  expect(script).toMatchObject({
    kind: 'script',
    language: 'typescript',
    runtime: 'worker',
    entryPoint: 'scripts/collectEscape.ts',
  });
  expect(sourceCatalog).toMatchObject({
    kind: 'data',
    value: {
      format: 'threejs-studio.source-catalog.v1',
      scriptAssetId: COLLECT_ESCAPE_SCRIPT_ASSET_ID,
      files: { 'scripts/collectEscape.ts': COLLECT_ESCAPE_BEHAVIOR_SOURCE },
    },
  });
  expect(template.behaviorSources['scripts/collectEscape.ts']).toContain('defineBehavior');
  expect(template.behaviorSources['scripts/collectEscape.ts']).toContain('onFixedUpdate');
  expect(template.behaviorSources['scripts/collectEscape.ts']).toContain('onCollisionEnter');
  expect(template.behaviorSources['scripts/collectEscape.ts']).toContain("action.actionId === 'restart'");
  expect(template.behaviorSources['scripts/collectEscape.ts']).toContain('ctx.api.scenes.restart()');
  const transpiled = ts.transpileModule(COLLECT_ESCAPE_BEHAVIOR_SOURCE, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  expect(transpiled.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? []).toEqual([]);

  expect(project.variables).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'score', defaultValue: 0, scope: 'session' }),
    expect.objectContaining({ id: 'timeRemaining', defaultValue: 60, scope: 'session' }),
    expect.objectContaining({ id: 'exitUnlocked', defaultValue: false }),
    expect.objectContaining({ id: 'bestTimeRemaining', scope: 'save' }),
  ]));
  expect(project.events.map((event) => event.id)).toEqual(expect.arrayContaining([
    'pickup.collected',
    'round.won',
    'round.failed',
    'round.restart',
  ]));

  expect(project.defaultBuildProfileId).toBe(COLLECT_ESCAPE_BUILD_PROFILE_ID);
  expect(project.buildProfiles[0]).toMatchObject({ target: 'web', mode: 'production', offline: true, basePath: './' });
  expect(project.permissions.network).toEqual({ policy: 'deny', origins: [] });
  expect(project.permissions.gamepad).toBe(true);
  expect(project.permissions.microphone).toBe(false);
  expect(project.permissions.camera).toBe(false);
});
