import { expect, test } from '@playwright/test';

test('Collect & Escape runs through Play, pause, exact step, restart, and Stop without authoring mutation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop editor journey; touch runtime coverage is in project-game-runtime.spec.ts.');
  await page.goto('/');

  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New Collect & Escape game' }).click();
  const workspace = page.getByTestId('game-authoring-workspace');
  await expect(workspace).toBeVisible();

  const authoredBefore = await page.evaluate(() => {
    const snapshot = window.__THREEJS_STUDIO_AGENT__?.snapshot() as {
      project?: { entities?: Array<{ id: string; transform: unknown }> };
    };
    return snapshot.project?.entities?.find((entity) => entity.id === 'entity.player')?.transform;
  });

  await workspace.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-runtime', 'playing', { timeout: 15_000 });
  const authoredBehaviorFrame = page.locator('[data-threejs-studio-runtime-preview]');
  await expect(authoredBehaviorFrame).toHaveCount(1);
  await expect(authoredBehaviorFrame).toBeHidden();
  await expect.poll(async () => {
    const name = await authoredBehaviorFrame.getAttribute('name');
    const frame = name ? page.frame({ name }) : null;
    if (!frame) return null;
    return frame.evaluate(() => {
      const status = (
        globalThis as typeof globalThis & {
          __THREEJS_STUDIO_AUTHORED_BEHAVIOR_STATUS__?: {
            tick?: number;
            variables?: Record<string, unknown>;
          };
        }
      ).__THREEJS_STUDIO_AUTHORED_BEHAVIOR_STATUS__;
      return (
        (status?.tick ?? 0) > 0
        && status?.variables?.score === 0
        && Number(status?.variables?.timeRemaining ?? 60) < 60
      );
    });
  }).toBe(true);
  const runtimeUI = page.locator('[data-runtime-ui-document="ui.collect-escape.hud"]');
  await expect(runtimeUI).toBeVisible();
  await expect(runtimeUI.getByText('Shards 0 / 5')).toBeVisible();

  await page.keyboard.down('KeyD');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyD');
  await expect.poll(async () => page.evaluate(() => {
    const game = window.__THREEJS_STUDIO_DIAGNOSTICS__?.runtime.game as {
      snapshot?: { tick?: number };
      diagnostics?: { physics?: { totalSteps?: number } };
    } | undefined;
    return (game?.snapshot?.tick ?? 0) > 0 && (game?.diagnostics?.physics?.totalSteps ?? 0) > 0;
  })).toBe(true);

  const movedX = await page.evaluate(() => {
    const transform = window.__THREEJS_STUDIO_DIAGNOSTICS__?.runtime.transforms['entity.player'];
    return transform?.position[0] ?? 0;
  });
  expect(movedX).toBeGreaterThan(0.25);

  await page.getByTestId('pause-button').click();
  await expect(page.getByTestId('pause-button')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => page.evaluate(() => {
    const game = window.__THREEJS_STUDIO_DIAGNOSTICS__?.runtime.game as { diagnostics?: { status?: string } } | undefined;
    return game?.diagnostics?.status;
  })).toBe('paused');
  await expect.poll(() => page.evaluate(() => (
    window.__THREEJS_STUDIO_DIAGNOSTICS__?.runtime.authoredBehavior as { status?: string } | undefined
  )?.status)).toBe('paused');
  const pausedTick = await page.evaluate(() => {
    const game = window.__THREEJS_STUDIO_DIAGNOSTICS__?.runtime.game as { snapshot?: { tick?: number } } | undefined;
    return game?.snapshot?.tick ?? 0;
  });
  await page.getByRole('button', { name: 'Step one frame' }).click();
  await expect.poll(async () => page.evaluate(() => {
    const game = window.__THREEJS_STUDIO_DIAGNOSTICS__?.runtime.game as { snapshot?: { tick?: number } } | undefined;
    return game?.snapshot?.tick ?? 0;
  })).toBe(pausedTick + 1);
  await page.getByTestId('pause-button').click();
  await expect.poll(async () => page.evaluate(() => {
    const game = window.__THREEJS_STUDIO_DIAGNOSTICS__?.runtime.game as { diagnostics?: { status?: string } } | undefined;
    return game?.diagnostics?.status;
  })).toBe('running');

  await page.keyboard.down('KeyR');
  await page.waitForTimeout(50);
  await page.keyboard.up('KeyR');
  await expect.poll(async () => page.evaluate(() => {
    const game = window.__THREEJS_STUDIO_DIAGNOSTICS__?.runtime.game as {
      snapshot?: { restartCount?: number; hud?: { score?: number; roundState?: string } };
    } | undefined;
    return game?.snapshot;
  })).toMatchObject({ restartCount: 1, hud: { score: 0, roundState: 'playing' } });
  await expect.poll(() => page.evaluate(() => (
    window.__THREEJS_STUDIO_DIAGNOSTICS__?.runtime.authoredBehavior as { restartCount?: number } | undefined
  )?.restartCount ?? 0)).toBe(1);

  await page.getByTestId('stop-button').click();
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-runtime', 'edit');
  await expect(runtimeUI).toHaveCount(0);
  await expect(authoredBehaviorFrame).toHaveCount(0);
  const authoredAfter = await page.evaluate(() => {
    const snapshot = window.__THREEJS_STUDIO_AGENT__?.snapshot() as {
      project?: { entities?: Array<{ id: string; transform: unknown }> };
    };
    return snapshot.project?.entities?.find((entity) => entity.id === 'entity.player')?.transform;
  });
  expect(authoredAfter).toEqual(authoredBefore);
});

test('stopping Preview during asynchronous preparation disposes the controller that resolves afterward', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The lifecycle race only needs one desktop browser pass.');
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New Collect & Escape game' }).click();
  await page.getByRole('button', { name: 'Close game authoring workspace' }).click();

  await page.evaluate(async () => {
    const modulePath = '/src/editor/ViewportEngine.ts';
    const { ViewportEngine } = await import(modulePath) as typeof import('../src/editor/ViewportEngine');
    const prototype = ViewportEngine.prototype;
    const originalPrepare = prototype.prepareGameRuntime;
    const originalCancel = prototype.cancelPreparedGameRuntime;
    let releasePreparation: (() => void) | undefined;
    const preparationGate = new Promise<void>((resolve) => { releasePreparation = resolve; });
    const raceWindow = window as unknown as {
      __qaRuntimeCancelCount?: number;
      __qaRuntimePreparationEntered?: boolean;
      __qaReleaseRuntimePreparation?: () => void;
      __qaRestoreRuntimePreparation?: () => void;
    };
    raceWindow.__qaRuntimeCancelCount = 0;
    raceWindow.__qaRuntimePreparationEntered = false;
    raceWindow.__qaReleaseRuntimePreparation = () => releasePreparation?.();
    raceWindow.__qaRestoreRuntimePreparation = () => {
      prototype.prepareGameRuntime = originalPrepare;
      prototype.cancelPreparedGameRuntime = originalCancel;
    };
    prototype.prepareGameRuntime = async function prepareAfterGate(project, compiledBehavior) {
      raceWindow.__qaRuntimePreparationEntered = true;
      await preparationGate;
      return originalPrepare.call(this, project, compiledBehavior);
    };
    prototype.cancelPreparedGameRuntime = function countCancellation() {
      raceWindow.__qaRuntimeCancelCount = (raceWindow.__qaRuntimeCancelCount ?? 0) + 1;
      return originalCancel.call(this);
    };
  });

  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: 'Open clean game preview' }).click();
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-runtime', 'preparing');
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __qaRuntimePreparationEntered?: boolean }
  ).__qaRuntimePreparationEntered), { timeout: 15_000 }).toBe(true);
  await page.getByRole('button', { name: /Exit Preview/ }).click();
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __qaRuntimeCancelCount?: number }
  ).__qaRuntimeCancelCount)).toBe(1);

  await page.evaluate(() => (
    window as unknown as { __qaReleaseRuntimePreparation?: () => void }
  ).__qaReleaseRuntimePreparation?.());
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __qaRuntimeCancelCount?: number }
  ).__qaRuntimeCancelCount), { timeout: 15_000 }).toBe(2);
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-runtime', 'edit');
  await expect(page.locator('[data-runtime-ui-document="ui.collect-escape.hud"]')).toHaveCount(0);

  await page.evaluate(() => (
    window as unknown as { __qaRestoreRuntimePreparation?: () => void }
  ).__qaRestoreRuntimePreparation?.());
});
