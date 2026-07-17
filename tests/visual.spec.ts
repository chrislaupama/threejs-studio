import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { makeExternalBufferGltf, makeTriangleGlb } from './fixtures/modelFixtures';

type CanvasSample = {
  ok: boolean;
  reason: string;
  variance?: number;
  colorBuckets?: number;
};

async function openFresh(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('threejs-game-studio-assets');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  });
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

async function saveCurrentProject(page: Page) {
  const saveButton = page.getByTestId('save-project');
  if (await saveButton.isVisible()) await saveButton.click();
  else await page.evaluate(() => (document.querySelector('[data-testid="save-project"]') as HTMLButtonElement | null)?.click());
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
  test.setTimeout(45_000);
  await openFresh(page);
  await page.getByTestId('experience-toggle').getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-experience', 'advanced');

  await page.locator('[data-node-id="player-ring"]').click();
  await page.getByTestId('make-it-move').click();
  await page.locator('.component-menu').getByRole('button', { name: /Float/ }).click();
  await expect(page.locator('[data-component-id]')).toHaveCount(2);
  await saveCurrentProject(page);

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

test('Input Actions rebind movement across UI, Play, build, diagnostics, and Undo', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Full keyboard authoring and runtime parity runs once on desktop.');
  await openFresh(page);
  await page.getByTestId('experience-toggle').getByRole('button', { name: 'Advanced' }).click();
  await page.locator('[data-node-id="player-rig"]').click();
  await expect(page.getByTestId('manage-input-actions')).toBeVisible();
  await page.getByTestId('manage-input-actions').click();

  const controls = page.getByTestId('input-actions-editor');
  const moveAction = page.locator('[data-testid="input-action-card"][data-action-id="player.move"]');
  await expect(controls).toBeVisible();
  await expect(moveAction.getByTestId('input-action-name')).toHaveValue('Move');
  const forwardBinding = moveAction.locator('[data-testid="input-binding-code"][data-binding-id="player.move.key-w"]');
  const alternateForwardBinding = moveAction.locator('[data-testid="input-binding-code"][data-binding-id="player.move.arrow-up"]');
  await expect(forwardBinding).toHaveValue('KeyW');
  await expect(forwardBinding.locator('option[value="KeyA"]')).toBeDisabled();
  await forwardBinding.selectOption('KeyI');
  await alternateForwardBinding.selectOption('ControlLeft');
  await expect(forwardBinding).toHaveValue('KeyI');

  await page.getByTestId('experience-toggle').getByRole('button', { name: 'Essentials' }).click();
  await expect(page.getByTestId('reset-move-controls')).toBeEnabled();
  await page.getByTestId('reset-move-controls').click();
  await expect(page.getByTestId('reset-move-controls')).toBeDisabled();
  await page.keyboard.press('Control+Z');
  await page.getByTestId('experience-toggle').getByRole('button', { name: 'Advanced' }).click();
  await expect(page.locator('[data-testid="input-binding-code"][data-binding-id="player.move.key-w"]')).toHaveValue('KeyI');

  await page.locator('[data-node-id="player-rig"]').click();
  await expect(page.getByTestId('keyboard-move-action')).toHaveValue('player.move');
  await page.getByTestId('experience-toggle').getByRole('button', { name: 'Essentials' }).click();
  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('runtime-banner')).toContainText('I / A / S / D');
  const before = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.transforms['player-rig']?.position ?? []);

  await page.keyboard.down('w');
  await page.waitForTimeout(350);
  await page.keyboard.up('w');
  const afterOldKey = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.transforms['player-rig']?.position ?? []);
  expect(Math.abs((afterOldKey[2] ?? 0) - (before[2] ?? 0))).toBeLessThan(0.03);

  await page.keyboard.down('i');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.input.actions['player.move']?.[1])).toBe(1);
  await page.waitForTimeout(350);
  await page.keyboard.up('i');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.transforms['player-rig']?.position[2] ?? 0)).toBeLessThan((before[2] ?? 0) - 0.2);

  await page.keyboard.down('Control');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.input.pressedCodes)).toContain('ControlLeft');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.input.actions['player.move']?.[1])).toBe(1);
  await page.keyboard.up('Control');

  await page.keyboard.down('i');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.input.pressedCodes)).toContain('KeyI');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.input.pressedCodes)).toEqual([]);
  await page.keyboard.up('i');

  await page.getByTestId('stop-button').click();
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.runtime.transforms['player-rig']?.position)).toEqual([0, 1.55, 0]);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('build-button').click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const html = await readFile(downloadPath!, 'utf8');
  expect(html).toContain('"code":"KeyI"');
  expect(html).toContain('"code":"ControlLeft"');
  expect(html).toContain('resolveAction(component.actionId)');
  expect(html).not.toContain("keys.has('w')");

  await page.getByTestId('experience-toggle').getByRole('button', { name: 'Advanced' }).click();
  await page.keyboard.press('Control+Z');
  await page.keyboard.press('Control+Z');
  await page.locator('[data-node-id="scene-root"]').click();
  await expect(page.locator('[data-testid="input-binding-code"][data-binding-id="player.move.key-w"]')).toHaveValue('KeyW');
});

test('self-contained GLB imports through Essentials and survives reload', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openFresh(page);
  const fixture = makeTriangleGlb();
  expect(fixture.byteLength).toBe(996);

  await page.getByTestId('model-file-input').setInputFiles({
    name: 'qa-triangle.glb',
    mimeType: 'model/gltf-binary',
    buffer: fixture,
  });
  await expect.poll(
    async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.assets.readyInstances ?? 0),
    { timeout: 10_000 },
  ).toBe(1);
  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(diagnostics?.editor).toMatchObject({ schemaVersion: 4, assetCount: 1, objectCount: 14 });
  expect(diagnostics?.assets.cachedModels).toBe(1);
  await expect(page.getByTestId('quick-start')).toHaveAttribute('data-step', 'style');
  expect(await sampleCanvas(page)).toMatchObject({ ok: true });

  await saveCurrentProject(page);
  await page.reload();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.assets.readyInstances ?? 0) === 1);
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.assetCount)).toBe(1);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Advanced models reuse GPU resources, recover missing bytes, and embed in builds', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Dense asset lifecycle coverage runs once on desktop.');
  test.setTimeout(60_000);
  const fixture = makeTriangleGlb();
  await openFresh(page);
  await page.getByTestId('model-file-input').setInputFiles({
    name: 'qa-triangle.glb',
    mimeType: 'model/gltf-binary',
    buffer: fixture,
  });
  await expect.poll(
    async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.assets.readyInstances ?? 0),
    { timeout: 10_000 },
  ).toBe(1);
  const geometryCount = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.renderer.geometries ?? 0);

  await page.getByTestId('experience-toggle').getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Project assets' }).click();
  const assetCard = page.locator('[data-asset-id^="model-asset-"]');
  await expect(assetCard).toHaveCount(1);
  await assetCard.click();
  await page.locator('.asset-action-bar').getByRole('button', { name: 'Add to scene' }).click();
  await page.locator('.asset-action-bar').getByRole('button', { name: 'Add to scene' }).click();
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.assets.readyInstances ?? 0)).toBe(3);
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.editor.objectCount ?? 0)).toBe(16);
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.assets.cachedModels)).toBe(1);
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.renderer.geometries)).toBe(geometryCount);

  await page.getByTestId('save-project').click();
  const metadata = await page.evaluate(() => JSON.parse(localStorage.getItem('threejs-game-studio:project:v4') ?? '{}') as {
    id: string;
    assets: Array<{ id: string; revision: number }>;
  });
  const storedKey = `${metadata.id}::${metadata.assets[0].id}::${metadata.assets[0].revision}`;
  await page.evaluate(async ({ key }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('threejs-game-studio-assets', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('modelSources', 'readwrite');
        transaction.objectStore('modelSources').delete(key);
        transaction.oncomplete = () => { request.result.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { key: storedKey });
  await page.reload();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.assets.missingInstances ?? 0) === 3);
  await expect(page.getByTestId('model-import-status')).toHaveAttribute('data-asset-status', 'missing');
  await expect(page.getByTestId('model-import-status')).toContainText('needs its source file');
  await page.getByTestId('build-button').click();
  await expect(page.getByRole('status')).toContainText('Build failed');

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('model-relink').first().click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'qa-triangle.glb', mimeType: 'model/gltf-binary', buffer: fixture });
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.assets.readyInstances ?? 0)).toBe(3);

  const packageDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('button', { name: 'Export editable project' }).click();
  const packageDownload = await packageDownloadPromise;
  const packagePath = await packageDownload.path();
  expect(packagePath).toBeTruthy();
  const packageValue = JSON.parse(await readFile(packagePath!, 'utf8')) as {
    format: string;
    project: { assets: Array<{ id: string; revision: number }> };
    assetSources: Array<{ assetId: string; revision: number; base64: string }>;
  };
  expect(packageValue.format).toBe('threejs-game-studio-project');
  expect(packageValue.assetSources).toHaveLength(1);
  expect(packageValue.assetSources[0].base64).toBe(fixture.toString('base64'));

  const relinkedKey = `${metadata.id}::${packageValue.project.assets[0].id}::${packageValue.project.assets[0].revision}`;
  await page.evaluate(async ({ key }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('threejs-game-studio-assets', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('modelSources', 'readwrite');
        transaction.objectStore('modelSources').delete(key);
        transaction.oncomplete = () => { request.result.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { key: relinkedKey });
  await page.getByTestId('project-file-input').setInputFiles(packagePath!);
  await saveCurrentProject(page);
  await page.reload();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.assets.readyInstances ?? 0) === 3);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('build-button').click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const html = await readFile(downloadPath!, 'utf8');
  expect(html).toContain(`data:model/gltf-binary;base64,${fixture.toString('base64')}`);
  expect(html).toContain(metadata.assets[0].id);
});

test('external-resource glTF fails atomically with actionable guidance', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Import error coverage runs once on desktop.');
  await openFresh(page);
  await page.getByTestId('model-file-input').setInputFiles({
    name: 'external.gltf',
    mimeType: '',
    buffer: makeExternalBufferGltf(),
  });
  await expect(page.getByTestId('model-import-status')).toHaveAttribute('data-asset-status', 'error');
  await expect(page.getByTestId('model-import-status')).toContainText('external buffer');
  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(diagnostics?.editor).toMatchObject({ assetCount: 0, objectCount: 13 });
});
