import { expect, test } from '@playwright/test';

test('AI Play keeps a detected V5 runtime in Edit mode when preparation reports failure', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The async editor-host lifecycle contract needs one desktop pass.');
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREEJS_STUDIO_AGENT__));

  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New Collect & Escape game' }).click();
  await page.getByRole('button', { name: 'Close game authoring workspace' }).click();

  await page.evaluate(async () => {
    const modulePath = '/src/editor/ViewportEngine.ts';
    const { ViewportEngine } = await import(modulePath) as typeof import('../src/editor/ViewportEngine');
    const prototype = ViewportEngine.prototype;
    const originalPrepare = prototype.prepareGameRuntime;
    const lifecycleWindow = window as unknown as {
      __qaFailedRuntimeAppliedCount?: number;
      __qaRestoreFailedRuntimePreparation?: () => void;
    };
    lifecycleWindow.__qaFailedRuntimeAppliedCount = 0;
    lifecycleWindow.__qaRestoreFailedRuntimePreparation = () => {
      prototype.prepareGameRuntime = originalPrepare;
    };
    prototype.prepareGameRuntime = async () => false;
    window.__THREEJS_STUDIO_AGENT__?.subscribe((event) => {
      if (event.type === 'proposal.applied') {
        lifecycleWindow.__qaFailedRuntimeAppliedCount = (lifecycleWindow.__qaFailedRuntimeAppliedCount ?? 0) + 1;
      }
    });
  });

  const proposalResult = await page.evaluate(async () => {
    const bridge = window.__THREEJS_STUDIO_AGENT__;
    if (!bridge) throw new Error('Studio Agent browser bridge is unavailable.');
    const current = await bridge.snapshot() as { revision: number };
    return bridge.request({
      tool: 'studio_control_runtime',
      arguments: { action: 'play' },
      baseRevision: current.revision,
      requestId: 'qa-runtime-preparation-failure',
    });
  });
  expect(proposalResult).toMatchObject({ status: 'approval_required', requestId: 'qa-runtime-preparation-failure' });

  await page.getByTestId('assistant-approve').click();
  await expect(page.getByTestId('assistant-proposal')).toBeVisible();
  await expect(page.getByTestId('assistant-panel')).toContainText('Play initialization did not complete successfully');
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-runtime', 'edit');
  await expect(page.getByRole('status')).toContainText('Play failed');
  await expect(page.locator('[data-runtime-ui-document="ui.collect-escape.hud"]')).toHaveCount(0);
  expect(await page.evaluate(() => (
    window as unknown as { __qaFailedRuntimeAppliedCount?: number }
  ).__qaFailedRuntimeAppliedCount)).toBe(0);

  await page.evaluate(() => (
    window as unknown as { __qaRestoreFailedRuntimePreparation?: () => void }
  ).__qaRestoreFailedRuntimePreparation?.());
});
