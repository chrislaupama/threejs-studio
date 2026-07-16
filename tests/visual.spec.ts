import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

type CanvasSample = {
  ok: boolean;
  reason: string;
  variance?: number;
  colorBuckets?: number;
};

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

test('renders the studio and completes core editor workflows', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('studio-app')).toBeVisible();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(diagnostics?.canvas.clientWidth).toBeGreaterThan(200);
  expect(diagnostics?.canvas.clientHeight).toBeGreaterThan(180);
  expect(diagnostics?.canvas.width).toBeGreaterThanOrEqual(diagnostics?.canvas.clientWidth ?? 0);
  expect(diagnostics?.editor.objectCount).toBe(13);

  const sample = await sampleCanvas(page);
  expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });

  if (testInfo.project.name.includes('desktop')) {
    await page.locator('[data-node-id="player-core"]').click();
    await expect(page.getByTestId('inspector-name')).toHaveValue('Player Core');
    await page.getByTestId('inspector-name').fill('Hero Core');
    await expect(page.locator('[data-node-id="player-core"] .tree-name')).toHaveText('Hero Core');
  }

  await page.getByTestId('add-object').click();
  await page.getByTestId('create-box').click();
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.objectCount)).toBe(14);

  await page.keyboard.press('Control+Z');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.objectCount)).toBe(13);

  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('studio-app')).toHaveClass(/mode-play/);
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.mode)).toBe('play');
  await page.getByTestId('pause-button').click();
  await expect(page.getByTestId('studio-app')).toHaveClass(/mode-paused/);
  await page.getByTestId('stop-button').click();
  await expect(page.getByTestId('studio-app')).toHaveClass(/mode-edit/);

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${testInfo.project.name}-studio`, { body: screenshot, contentType: 'image/png' });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
