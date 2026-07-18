import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocumentV5 } from '../src/editor/types';
import {
  createProjectGameRuntime,
  detectProjectRuntimeBindings,
  ProjectGameRuntimeError,
  RUNTIME_BINDINGS_FORMAT,
  validateRuntimeBindingsManifest,
  type ProjectGameRuntimeTransformUpdate,
  type RuntimeBindingManifestV1,
} from '../src/runtime/ProjectGameRuntime';
import { createCollectEscapeProject } from '../src/templates/collectEscape';

function getManifest(project: ProjectDocumentV5): RuntimeBindingManifestV1 {
  const asset = project.assets.find((candidate) => (
    candidate.kind === 'data'
    && typeof candidate.value === 'object'
    && candidate.value !== null
    && !Array.isArray(candidate.value)
    && candidate.value.format === RUNTIME_BINDINGS_FORMAT
  ));
  if (!asset || asset.kind !== 'data') throw new Error('Missing runtime binding fixture asset.');
  return asset.value as unknown as RuntimeBindingManifestV1;
}

test('detects the versioned runtime binding asset and rejects invalid fixed-step contracts', () => {
  const project = createCollectEscapeProject();
  const detected = detectProjectRuntimeBindings(project);
  expect(detected).toMatchObject({
    sceneId: project.startupSceneId,
    manifest: {
      schemaVersion: 1,
      format: RUNTIME_BINDINGS_FORMAT,
      fixedDeltaSeconds: 1 / 60,
    },
    uiDocument: { schemaVersion: 1 },
  });

  getManifest(project).fixedDeltaSeconds = 1 / 30;
  expect(() => detectProjectRuntimeBindings(project)).toThrow(ProjectGameRuntimeError);
  try {
    detectProjectRuntimeBindings(project);
  } catch (error) {
    expect(error).toMatchObject({
      code: 'INVALID_MANIFEST',
      details: [expect.stringContaining('shared 60 Hz runtime')],
    });
  }

  expect(validateRuntimeBindingsManifest({
    format: RUNTIME_BINDINGS_FORMAT,
    schemaVersion: 1,
    fixedDeltaSeconds: 1 / 60,
    maxCatchUpTicks: 5,
    systemOrder: [],
    physics: { gravity: [0, -9.81, 0], bodies: [null] },
    input: {},
    componentBindings: [],
    rules: { roundSeconds: 60, pickupTarget: 1, playerSpawn: [0, 0, 0], resetEventId: 'round.restart' },
  })).toEqual(expect.arrayContaining([
    expect.stringContaining('physics.bodies are malformed'),
    expect.stringContaining('input is malformed'),
  ]));
});

test('moves the character from generalized keyboard input without mutating ProjectDocumentV5', async () => {
  const project = createCollectEscapeProject();
  const authoredBefore = JSON.stringify(project);
  const updates: ProjectGameRuntimeTransformUpdate[] = [];
  const controller = await createProjectGameRuntime({
    project,
    host: { setEntityTransform: (update) => updates.push(update) },
  });
  expect(controller).not.toBeNull();
  controller!.start();
  updates.length = 0;
  controller!.setKeyboardKey('KeyD', true);
  const snapshot = controller!.fixedUpdate();
  const player = updates.filter((update) => update.entityId === snapshot.playerEntityId).at(-1);

  expect(player?.position[0]).toBeGreaterThan(0);
  expect(snapshot).toMatchObject({ status: 'running', tick: 1, hud: { score: 0, roundState: 'playing' } });
  expect(controller!.getDiagnostics()).toMatchObject({
    status: 'running',
    input: { keyboardKeys: 1 },
    physics: { initialized: true, totalSteps: 1 },
  });
  expect(JSON.stringify(project)).toBe(authoredBefore);
  controller!.dispose();
  controller!.dispose();
  expect(controller!.getSnapshot().status).toBe('disposed');
  expect(() => controller!.setKeyboardKey('KeyD', false)).toThrow(/disposed/i);
});

test('resolves pickup before exit, produces a deterministic win, and restores runtime-only state on restart', async () => {
  const project = createCollectEscapeProject();
  const manifest = getManifest(project);
  manifest.rules.pickupTarget = 1;
  const spawn = [...manifest.rules.playerSpawn] as [number, number, number];
  const triggerPosition: [number, number, number] = [spawn[0], spawn[1], spawn[2] - 0.9];
  const firstPickup = manifest.physics.bodies.find((body) => body.id.startsWith('physics.pickup.'))!;
  const exit = manifest.physics.bodies.find((body) => body.id === 'physics.exit')!;
  firstPickup.position = [...triggerPosition];
  exit.position = [...triggerPosition];
  const activeUpdates: Array<[string, boolean]> = [];
  const eventIds: string[] = [];
  const controller = await createProjectGameRuntime({
    project,
    host: {
      setEntityActive: (entityId, active) => activeUpdates.push([entityId, active]),
      onEvent: (event) => eventIds.push(event.eventId),
    },
  });
  controller!.start();
  controller!.setKeyboardKey('KeyW', true);
  let won = controller!.fixedUpdate();
  for (let tick = 0; tick < 8 && won.hud.roundState === 'playing'; tick += 1) won = controller!.fixedUpdate();

  expect(won.hud).toMatchObject({
    score: 1,
    pickupsRemaining: 0,
    exitUnlocked: true,
    roundState: 'won',
    gameOver: true,
    statusMessage: 'Escaped!',
  });
  expect(won.collectedEntityIds).toHaveLength(1);
  expect(activeUpdates).toContainEqual([won.collectedEntityIds[0], false]);
  expect(eventIds).toEqual(expect.arrayContaining(['pickup.collected', 'exit.reached', 'round.won']));

  const restarted = controller!.restart();
  expect(restarted).toMatchObject({
    status: 'running',
    tick: 0,
    restartCount: 1,
    collectedEntityIds: [],
    hud: { score: 0, pickupsRemaining: 1, exitUnlocked: false, roundState: 'playing', gameOver: false },
  });
  expect(activeUpdates).toContainEqual([won.collectedEntityIds[0], true]);
  expect(JSON.stringify(project)).toContain('"active":true');
  controller!.dispose();
});

test('fails on the exact configured countdown tick and accepts restart as a virtual action', async () => {
  const project = createCollectEscapeProject();
  const manifest = getManifest(project);
  manifest.rules.roundSeconds = 1 / 60;
  const controller = await createProjectGameRuntime({ project });
  controller!.start();
  const failed = controller!.fixedUpdate();
  expect(failed).toMatchObject({
    tick: 1,
    hud: { timeRemaining: 0, roundState: 'failed', gameOver: true, statusMessage: 'Time expired' },
  });

  controller!.pulseAction('restart');
  const restarted = controller!.fixedUpdate();
  expect(restarted).toMatchObject({ tick: 0, restartCount: 1, hud: { roundState: 'playing', gameOver: false } });
  controller!.dispose();
});

async function mountBrowserRuntime(page: Page) {
  await page.goto('/');
  return page.evaluate(async () => {
    document.body.replaceChildren();
    document.body.style.margin = '0';
    const target = document.createElement('main');
    target.id = 'runtime-game-hud';
    target.style.position = 'relative';
    target.style.width = '800px';
    target.style.height = '600px';
    document.body.append(target);
    const runtimeUrl = '/src/runtime/ProjectGameRuntime.ts';
    const templateUrl = '/src/templates/collectEscape.ts';
    const runtime = await import(runtimeUrl) as typeof import('../src/runtime/ProjectGameRuntime');
    const template = await import(templateUrl) as typeof import('../src/templates/collectEscape');
    const positions: number[] = [];
    const controller = await runtime.createProjectGameRuntime({
      project: template.createCollectEscapeProject(),
      host: {
        hudTarget: target,
        touchAvailable: true,
        setEntityTransform: (update) => {
          if (update.entityId === 'entity.player') positions.push(update.position[0]);
        },
      },
    });
    if (!controller) throw new Error('Expected Collect & Escape controller.');
    controller.start();
    const button = target.querySelector<HTMLButtonElement>('[data-ui-id="touch.right"]');
    if (!button) throw new Error('Missing runtime touch button.');
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
    controller.fixedUpdate();
    controller.fixedUpdate();
    const heldX = positions.at(-1) ?? 0;
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
    controller.fixedUpdate();
    const releasedX = positions.at(-1) ?? 0;
    controller.fixedUpdate();
    const stoppedX = positions.at(-1) ?? 0;
    const result = {
      heldX,
      releasedX,
      stoppedX,
      touchVisible: !button.hidden && button.getBoundingClientRect().width >= 44,
      rootsBeforeDispose: target.querySelectorAll('[data-runtime-ui-root]').length,
    };
    controller.dispose();
    return {
      ...result,
      rootsAfterDispose: target.querySelectorAll('[data-runtime-ui-root]').length,
      status: controller.getSnapshot().status,
    };
  });
}

test('mounted runtime UI holds directional pointer input until release and cleans up', async ({ page }) => {
  const result = await mountBrowserRuntime(page);
  expect(result.heldX).toBeGreaterThan(0);
  expect(result.releasedX).toBeCloseTo(result.stoppedX, 7);
  expect(result).toMatchObject({
    touchVisible: true,
    rootsBeforeDispose: 1,
    rootsAfterDispose: 0,
    status: 'disposed',
  });
});
