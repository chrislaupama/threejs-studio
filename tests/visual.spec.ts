import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

type CanvasSample = {
  ok: boolean;
  reason: string;
  variance?: number;
  colorBuckets?: number;
};

async function openFresh(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
}

async function sampleCanvas(page: Page): Promise<CanvasSample> {
  const canvas = page.getByTestId('scene-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width < 32 || box.height < 32) return { ok: false, reason: 'canvas-too-small' };

  const buffer = await canvas.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  let alphaPixels = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    if (a > 0) alphaPixels += 1;
    buckets.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
  }

  const variance = max - min;
  return {
    ok: alphaPixels > 256 && variance > 8 && buckets.size > 6,
    reason: 'sampled',
    variance,
    colorBuckets: buckets.size,
  };
}

test('fresh Essentials journey advances only from real authoring actions', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openFresh(page);
  const studio = page.getByTestId('studio-app');
  await expect(studio).toHaveAttribute('data-experience', 'essentials');
  await expect(page.getByTestId('quick-start')).toHaveAttribute('data-step', 'add');
  await expect(page.getByText('Advanced world settings')).toHaveCount(0);

  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(diagnostics?.canvas.clientWidth).toBeGreaterThan(200);
  expect(diagnostics?.canvas.clientHeight).toBeGreaterThan(180);
  expect(diagnostics?.editor.objectCount).toBe(13);
  expect(await sampleCanvas(page)).toMatchObject({ ok: true });

  if (testInfo.project.name.includes('desktop')) {
    await page.locator('[data-node-id="player-core"]').click();
    await page.getByTestId('inspector-name').fill('Hero Core');
    await expect(page.getByTestId('quick-start')).toHaveAttribute('data-step', 'add');
  }

  await page.getByTestId('add-object').click();
  await page.getByTestId('create-box').click();
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.objectCount)).toBe(14);
  await expect(page.getByTestId('quick-start')).toHaveAttribute('data-step', 'style');

  if (testInfo.project.name.includes('mobile')) {
    await page.getByRole('button', { name: 'Toggle details' }).click();
  }
  const colorInput = page.locator('.inspector-panel input[type="color"]').first();
  await expect(colorInput).toBeVisible();
  await colorInput.fill('#f47f6b');
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-step', 'play');
  if (testInfo.project.name.includes('mobile')) {
    await page.getByRole('button', { name: 'Toggle details' }).click();
  }

  await page.getByTestId('quick-start').getByRole('button', { name: 'Play the game' }).click();
  await expect(studio).toHaveClass(/mode-play/);
  await expect(page.getByTestId('runtime-banner')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.mode)).toBe('play');

  const runtimeBox = await page.getByTestId('runtime-banner').boundingBox();
  const viewport = page.viewportSize();
  expect(runtimeBox && viewport && runtimeBox.x >= 0 && runtimeBox.y >= 0 && runtimeBox.x + runtimeBox.width <= viewport.width && runtimeBox.y + runtimeBox.height <= viewport.height).toBeTruthy();

  await page.keyboard.press('Escape');
  await expect(studio).toHaveClass(/mode-edit/);
  await expect(page.getByTestId('quick-start')).toHaveAttribute('data-step', 'complete');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.objectCount)).toBe(14);

  const quickStartBox = await page.getByTestId('quick-start').boundingBox();
  expect(quickStartBox && viewport && quickStartBox.x >= 0 && quickStartBox.y >= 0 && quickStartBox.x + quickStartBox.width <= viewport.width && quickStartBox.y + quickStartBox.height <= viewport.height).toBeTruthy();

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${testInfo.project.name}-essentials-journey`, { body: screenshot, contentType: 'image/png' });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Advanced components compose and runtime remains isolated', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Dense runtime authoring coverage runs once on desktop.');
  await openFresh(page);
  await page.getByTestId('experience-toggle').getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-experience', 'advanced');

  await page.locator('[data-node-id="player-ring"]').click();
  await page.getByTestId('make-it-move').click();
  await page.locator('.component-menu').getByRole('button', { name: /Float/ }).click();
  await expect(page.locator('[data-component-id]')).toHaveCount(2);
  await page.getByTestId('save-project').click();

  await page.reload();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-experience', 'advanced');
  await page.locator('[data-node-id="player-ring"]').click();
  await expect(page.locator('[data-component-id]')).toHaveCount(2);
  await page.getByTestId('make-it-move').click();
  await page.locator('.component-menu').getByRole('button', { name: /Spin/ }).click();
  await expect(page.locator('[data-component-id]')).toHaveCount(3);

  const authoredPlayerPosition = [0, 1.55, 0];
  await page.getByTestId('play-button').click();
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.tick ?? 0)).toBeGreaterThan(2);
  const beforeMove = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.transforms['player-rig']?.position);
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.transforms['player-rig']?.position[2] ?? 0)).toBeLessThan((beforeMove?.[2] ?? 0) - 0.2);

  const objectCount = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.objectCount);
  await page.keyboard.press('Control+K');
  await expect(page.locator('.command-list').getByRole('button', { name: /Create Box/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('studio-app')).toHaveClass(/mode-play/);
  await page.keyboard.press('Control+Z');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.objectCount)).toBe(objectCount);

  await page.getByTestId('pause-button').click();
  await page.waitForTimeout(600);
  const frozenTick = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.tick ?? 0);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.tick ?? 0)).toBe(frozenTick);
  await page.getByRole('button', { name: 'Step one frame' }).click();
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.tick ?? 0)).toBe(frozenTick + 1);

  await page.getByTestId('stop-button').click();
  await expect(page.getByTestId('studio-app')).toHaveClass(/mode-edit/);
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.transforms['player-rig']?.position)).toEqual(authoredPlayerPosition);
  await page.keyboard.press('Control+Z');
  await expect(page.locator('[data-component-id]')).toHaveCount(2);
});
