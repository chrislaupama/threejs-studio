import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
      .toast, .viewport-stats, .autosave-state { visibility: hidden !important; }
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
  const frame = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0);
  await page.waitForFunction((previousFrame) => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > previousFrame + 2, frame);
  await page.waitForTimeout(120);
  await expect(page).toHaveScreenshot(`studio-advanced-${testInfo.project.name}.png`, {
    fullPage: true,
    maxDiffPixelRatio: 0.012,
  });
});
