import { expect, test, type Page } from '@playwright/test';
import { makeTriangleGlb } from './fixtures/modelFixtures';

async function prepare(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await Promise.all(['threejs-studio-assets', 'threejs-game-studio-assets'].map((databaseName) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    })));
  });
  await page.reload();
  await page.waitForFunction(() => (window.__THREEJS_STUDIO_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
      .toast, .viewport-stats, .autosave-state { visibility: hidden !important; }
      .statusbar > div:last-child > span:nth-child(3) { visibility: hidden !important; }
    `,
  });
  await page.waitForTimeout(120);
}

test('Essentials editor visual baseline', async ({ page }, testInfo) => {
  await prepare(page);
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-experience', 'essentials');
  await expect(page).toHaveScreenshot(`studio-essentials-${testInfo.project.name}.png`, {
    fullPage: true,
    maxDiffPixelRatio: 0.012,
  });
});

test('Advanced editor visual baseline', async ({ page }, testInfo) => {
  await prepare(page);
  await page.getByTestId('experience-toggle').getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-experience', 'advanced');
  const frame = await page.evaluate(() => window.__THREEJS_STUDIO_DIAGNOSTICS__?.frame ?? 0);
  await page.waitForFunction((previousFrame) => (window.__THREEJS_STUDIO_DIAGNOSTICS__?.frame ?? 0) > previousFrame + 2, frame);
  await page.waitForTimeout(120);
  await expect(page).toHaveScreenshot(`studio-advanced-${testInfo.project.name}.png`, {
    fullPage: true,
    maxDiffPixelRatio: 0.012,
  });
});

test('Advanced Input Actions visual baseline', async ({ page }, testInfo) => {
  await prepare(page);
  await page.getByTestId('experience-toggle').getByRole('button', { name: 'Advanced' }).click();
  if (testInfo.project.name.includes('mobile')) {
    await page.getByRole('button', { name: 'Toggle objects' }).click();
    await page.locator('[data-node-id="scene-root"]').click();
    await page.getByRole('button', { name: 'Toggle details' }).click();
  } else {
    await page.locator('[data-node-id="scene-root"]').click();
  }
  await expect(page.getByTestId('input-actions-editor')).toBeVisible();
  await page.addStyleTag({ content: '.toast, .viewport-stats, .autosave-state { visibility: hidden !important; }' });
  await page.waitForTimeout(120);
  await expect(page).toHaveScreenshot(`studio-input-actions-${testInfo.project.name}.png`, {
    fullPage: true,
    maxDiffPixelRatio: 0.012,
  });
});

test('Studio Assistant proposal visual baseline', async ({ page }, testInfo) => {
  await prepare(page);
  const desktopToggle = page.getByTestId('assistant-toggle');
  if (await desktopToggle.isVisible()) {
    await page.getByTestId('experience-toggle').getByRole('button', { name: 'Advanced' }).click();
    await desktopToggle.click();
  } else {
    await page.getByTestId('assistant-mobile-trigger').click();
  }
  await page.getByTestId('assistant-input').fill('Add a coral box called Enemy beside Player Core and make it spin.');
  await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-proposal')).toBeVisible();
  await page.waitForTimeout(120);
  await expect(page).toHaveScreenshot(`studio-assistant-${testInfo.project.name}.png`, {
    fullPage: true,
    maxDiffPixelRatio: 0.012,
  });
});

test('Imported model viewport visual baseline', async ({ page }, testInfo) => {
  await prepare(page);
  await page.getByTestId('model-file-input').setInputFiles({
    name: 'qa-triangle.glb',
    mimeType: 'model/gltf-binary',
    buffer: makeTriangleGlb(),
  });
  await page.waitForFunction(() => (window.__THREEJS_STUDIO_DIAGNOSTICS__?.assets.readyInstances ?? 0) === 1);
  if (testInfo.project.name.includes('mobile')) await page.getByRole('button', { name: 'Toggle details' }).click();
  const positionX = page.locator('.inspector-panel .vector-row').first().locator('input').first();
  await positionX.fill('3');
  await positionX.press('Enter');
  if (testInfo.project.name.includes('mobile')) await page.getByRole('button', { name: 'Toggle details' }).click();
  await page.keyboard.press('f');
  const frame = await page.evaluate(() => window.__THREEJS_STUDIO_DIAGNOSTICS__?.frame ?? 0);
  await page.waitForFunction((previousFrame) => (window.__THREEJS_STUDIO_DIAGNOSTICS__?.frame ?? 0) > previousFrame + 3, frame);
  await page.addStyleTag({ content: '.toast, .model-import-status, .viewport-stats, .quick-start-card { visibility: hidden !important; }' });
  await expect(page.getByTestId('scene-canvas')).toHaveScreenshot(`studio-imported-model-${testInfo.project.name}.png`, {
    maxDiffPixelRatio: 0.006,
  });
});

test('Advanced imported model authoring visual baseline', async ({ page }, testInfo) => {
  await prepare(page);
  await page.getByTestId('model-file-input').setInputFiles({
    name: 'qa-triangle.glb',
    mimeType: 'model/gltf-binary',
    buffer: makeTriangleGlb(),
  });
  await page.waitForFunction(() => (window.__THREEJS_STUDIO_DIAGNOSTICS__?.assets.readyInstances ?? 0) === 1);
  await page.getByTestId('experience-toggle').getByRole('button', { name: 'Advanced' }).click();
  if (testInfo.project.name.includes('mobile')) {
    await page.getByRole('button', { name: 'Toggle assets' }).click();
    await expect(page.getByTestId('studio-app')).toHaveClass(/panel-bottom-open/);
    await expect(page.locator('.mobile-panel-trigger')).toHaveCount(0);
  } else {
    await page.getByRole('button', { name: 'Project assets' }).click();
  }
  await page.locator('[data-asset-id^="model-asset-"]').click();
  await page.addStyleTag({
    content: `
      .toast, .model-import-status, .viewport-stats { visibility: hidden !important; }
      .model-diagnostics-grid > .is-wide > code { visibility: hidden !important; }
    `,
  });
  const frame = await page.evaluate(() => window.__THREEJS_STUDIO_DIAGNOSTICS__?.frame ?? 0);
  await page.waitForFunction((previousFrame) => (window.__THREEJS_STUDIO_DIAGNOSTICS__?.frame ?? 0) > previousFrame + 2, frame);
  await page.waitForTimeout(120);
  await expect(page).toHaveScreenshot(`studio-model-authoring-${testInfo.project.name}.png`, {
    fullPage: true,
    maxDiffPixelRatio: 0.012,
  });
});
