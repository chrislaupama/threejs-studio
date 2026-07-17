import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  DEFAULT_MOVE_ACTION_ID,
  createKeyboardInputBinding,
  updateInputAction,
} from '../src/editor/inputActions';
import { buildRuntimeHtml, createStarterProject } from '../src/editor/project';

type RuntimeDiagnostics = {
  schemaVersion: number;
  getNodePosition: (id: string) => number[] | null;
  getPressedCodes: () => string[];
  resolveAction: (id: string) => [number, number];
};

test('downloaded HTML boots offline-routed Three.js and runs authored input with cleanup', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'The standalone WebGL artifact only needs one browser execution pass.');
  test.setTimeout(45_000);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('https://cdn.jsdelivr.net/npm/three@0.184.0/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const relativePath = decodeURIComponent(requestUrl.pathname.split('/three@0.184.0/')[1] ?? '');
    if (!relativePath || relativePath.includes('..')) {
      await route.abort();
      return;
    }
    const body = await readFile(resolve(process.cwd(), 'node_modules/three', relativePath));
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      headers: { 'access-control-allow-origin': '*' },
      body,
    });
  });

  const project = createStarterProject();
  const rebound = updateInputAction(project, DEFAULT_MOVE_ACTION_ID, {
    bindings: [
      createKeyboardInputBinding('KeyJ', 'x', -1, 'player.move.key-j'),
      createKeyboardInputBinding('KeyL', 'x', 1, 'player.move.key-l'),
      createKeyboardInputBinding('KeyI', 'y', 1, 'player.move.key-i'),
      createKeyboardInputBinding('KeyK', 'y', -1, 'player.move.key-k'),
      createKeyboardInputBinding('ControlLeft', 'y', 1, 'player.move.control-left'),
    ],
  });
  if (!rebound) throw new Error('Could not create the standalone runtime fixture.');

  await page.setContent(buildRuntimeHtml(rebound), { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean((window as unknown as { __THREE_GAME_RUNTIME_DIAGNOSTICS__?: RuntimeDiagnostics }).__THREE_GAME_RUNTIME_DIAGNOSTICS__));
  const position = () => page.evaluate(() => (
    window as unknown as { __THREE_GAME_RUNTIME_DIAGNOSTICS__: RuntimeDiagnostics }
  ).__THREE_GAME_RUNTIME_DIAGNOSTICS__.getNodePosition('player-rig'));
  const pressedCodes = () => page.evaluate(() => (
    window as unknown as { __THREE_GAME_RUNTIME_DIAGNOSTICS__: RuntimeDiagnostics }
  ).__THREE_GAME_RUNTIME_DIAGNOSTICS__.getPressedCodes());

  const before = await position();
  expect(before).not.toBeNull();
  await page.keyboard.down('i');
  await expect.poll(pressedCodes).toContain('KeyI');
  await expect.poll(async () => (await position())?.[2] ?? 0).toBeLessThan((before?.[2] ?? 0) - 0.15);
  await page.keyboard.up('i');

  await page.keyboard.down('Control');
  await expect.poll(pressedCodes).toContain('ControlLeft');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(pressedCodes).toEqual([]);
  await page.keyboard.up('Control');

  await page.keyboard.down('i');
  await expect.poll(pressedCodes).toContain('KeyI');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(pressedCodes).toEqual([]);
  await page.keyboard.up('i');

  expect(errors).toEqual([]);
});
