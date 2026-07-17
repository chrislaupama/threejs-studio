import { expect, test } from '@playwright/test';
import {
  LEGACY_PORTABLE_PROJECT_FORMAT,
  PORTABLE_PROJECT_FORMAT,
  readPortableProjectBundle,
} from '../src/editor/assetStore';
import { createStarterProject } from '../src/editor/project';

test('ThreeJS Studio identity is canonical while legacy browser preferences and projects migrate', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'One browser pass covers same-origin identity migration.');
  const project = createStarterProject();

  await page.goto('/');
  await page.evaluate((legacyProject) => {
    localStorage.clear();
    localStorage.setItem('threejs-game-studio:project:v4', JSON.stringify(legacyProject));
    localStorage.setItem('threejs-game-studio:experience', 'advanced');
    localStorage.setItem('threejs-game-studio:quick-start', JSON.stringify({
      added: true,
      styled: true,
      played: true,
      dismissed: true,
    }));
  }, project);
  await page.reload();
  await page.waitForFunction(() => (window.__THREEJS_STUDIO_DIAGNOSTICS__?.frame ?? 0) > 10);

  await expect(page).toHaveTitle('ThreeJS Studio');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://threejs.studio');
  await expect(page.getByTestId('studio-app')).toHaveAttribute('data-experience', 'advanced');
  await expect(page.locator('.brand-lockup')).toContainText('ThreeJSStudio');

  const migrated = await page.evaluate(() => ({
    project: JSON.parse(localStorage.getItem('threejs-studio:project:v4') ?? 'null') as { id?: string } | null,
    experience: localStorage.getItem('threejs-studio:experience'),
    quickStart: JSON.parse(localStorage.getItem('threejs-studio:quick-start') ?? 'null') as { dismissed?: boolean } | null,
    legacyProjectRetained: localStorage.getItem('threejs-game-studio:project:v4') !== null,
  }));
  expect(migrated).toMatchObject({
    project: { id: project.id },
    experience: 'advanced',
    quickStart: { dismissed: true },
    legacyProjectRetained: true,
  });
});

test('portable project reader accepts the legacy discriminator while new exports use ThreeJS Studio', () => {
  const project = createStarterProject();
  expect(PORTABLE_PROJECT_FORMAT).toBe('threejs-studio-project');
  expect(LEGACY_PORTABLE_PROJECT_FORMAT).toBe('threejs-game-studio-project');
  expect(readPortableProjectBundle({
    format: LEGACY_PORTABLE_PROJECT_FORMAT,
    bundleVersion: 1,
    project,
    assetSources: [],
  })).toEqual({ project, sources: [] });
});
