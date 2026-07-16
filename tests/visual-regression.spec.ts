import { expect, test } from '@playwright/test';

test('studio editor visual baseline', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
      .toast, .viewport-stats, .autosave-state { visibility: hidden !important; }
    `,
  });
  await page.waitForTimeout(120);
  await expect(page).toHaveScreenshot(`studio-editor-${testInfo.project.name}.png`, {
    fullPage: true,
    maxDiffPixelRatio: 0.012,
  });
});
