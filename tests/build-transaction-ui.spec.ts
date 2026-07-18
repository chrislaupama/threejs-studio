import { expect, test } from '@playwright/test';

test('an editor revision change while build modules load rejects the stale snapshot without downloading', async ({ page }) => {
  let releaseModule!: () => void;
  let markModuleRequested!: () => void;
  const moduleReleased = new Promise<void>((resolve) => { releaseModule = resolve; });
  const moduleRequested = new Promise<void>((resolve) => { markModuleRequested = resolve; });
  let intercepted = false;
  let downloads = 0;

  page.on('download', () => { downloads += 1; });
  await page.route('**/src/build/scriptBuild.ts*', async (route) => {
    intercepted = true;
    markModuleRequested();
    await moduleReleased;
    await route.continue();
  });

  await page.goto('/');
  await page.getByTestId('build-button').click();
  await Promise.race([
    moduleRequested,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Script build module was not requested.')), 5_000)),
  ]);

  await page.getByTestId('add-object').click();
  await page.getByTestId('create-box').click();
  releaseModule();

  await expect(page.getByRole('status')).toContainText('Project changed from revision');
  expect(intercepted).toBe(true);
  expect(downloads).toBe(0);
});
