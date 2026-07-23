import { expect, test } from '@playwright/test';

test('production preview boots its hashed assets and enters Play without browser errors', async ({ page }) => {
  const browserErrors: string[] = [];
  const failedRequests: string[] = [];
  const failedResponses: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().startsWith('http://127.0.0.1:4188/')) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page).toHaveTitle('ThreeJS Studio');
  await expect(page.getByTestId('studio-app')).toBeVisible();
  await expect(page.getByTestId('scene-canvas')).toBeVisible();
  await page.waitForFunction(() => (window.__THREEJS_STUDIO_DIAGNOSTICS__?.frame ?? 0) > 10);

  const scripts = await page.locator('script[type="module"][src]').evaluateAll((elements) => (
    elements.map((element) => (element as HTMLScriptElement).src)
  ));
  expect(scripts).toHaveLength(1);
  expect(new URL(scripts[0]!).pathname).toMatch(/^\/assets\/index-[\w-]+\.js$/);

  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('studio-app')).toHaveClass(/mode-play/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('studio-app')).toHaveClass(/mode-edit/);

  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New Collect & Escape game' }).click();
  const workspace = page.getByTestId('game-authoring-workspace');
  await workspace.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-runtime', 'playing', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (
    window.__THREEJS_STUDIO_DIAGNOSTICS__?.runtime.authoredBehavior?.tick ?? 0
  ))).toBeGreaterThan(0);
  await page.getByTestId('stop-button').click();
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-runtime', 'edit');

  expect(browserErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(failedResponses).toEqual([]);
});
