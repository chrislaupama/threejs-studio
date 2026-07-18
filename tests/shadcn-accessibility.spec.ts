import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousAccessibilityViolations } from './helpers/a11y';

async function openFresh(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => (window.__THREEJS_STUDIO_DIAGNOSTICS__?.frame ?? 0) > 10);
}

async function openCommandPalette(page: Page) {
  await page.keyboard.press('Control+K');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder('Type a command or search…')).toBeFocused();
  return dialog;
}

test('responsive application menu preserves keyboard semantics and cleans up its portal', async ({ page }, testInfo) => {
  await openFresh(page);

  const menubar = page.getByRole('menubar', { name: 'Application menu' });
  const fileTrigger = page.locator('[data-slot="menubar-trigger"]').filter({ hasText: /^File$/ });
  await expect(fileTrigger).toHaveAttribute('role', 'menuitem');

  if (testInfo.project.name.includes('mobile')) {
    await expect(menubar).toBeHidden();
    await expect(fileTrigger).toBeHidden();
    await expect(page.getByRole('menu')).toHaveCount(0);
    return;
  }

  await fileTrigger.focus();
  await page.keyboard.press('Enter');

  const menu = page.getByRole('menu');
  const menuItems = page.locator('[data-slot="menubar-item"]');
  await expect(menu).toBeVisible();
  await expect(menuItems.filter({ hasText: /^Save/ })).toBeVisible();
  await expect(menuItems.filter({ hasText: /^New starter project/ })).toBeFocused();
  const saveItem = menuItems.filter({ hasText: /^Save/ });
  await saveItem.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Project saved locally');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(fileTrigger).toBeFocused();

  await fileTrigger.press('Enter');
  await expect(menuItems.first()).toHaveAttribute('role', 'menuitem');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveCount(0);
  await expect(fileTrigger).toBeFocused();
});

test('command dialog restores focus, activates commands by keyboard, and removes portal state', async ({ page }) => {
  await openFresh(page);

  const returnTarget = page.getByTestId('play-button');
  await returnTarget.focus();
  const dialog = await openCommandPalette(page);

  await expect(dialog.getByRole('option', { name: /^Save project/ })).toBeVisible();
  const beforeCount = await page.evaluate(() => window.__THREEJS_STUDIO_DIAGNOSTICS__?.editor.objectCount ?? 0);
  const input = dialog.getByPlaceholder('Type a command or search…');
  await input.fill('Create Box');
  await expect(dialog.getByRole('option', { name: /^Create Box/ })).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => window.__THREEJS_STUDIO_DIAGNOSTICS__?.editor.objectCount ?? 0)).toBe(beforeCount + 1);
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);

  await returnTarget.focus();
  const reopened = await openCommandPalette(page);
  await page.keyboard.press('Escape');
  await expect(reopened).toHaveCount(0);
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  await expect(returnTarget).toBeFocused();
});

test('typing surfaces suppress global editor shortcuts', async ({ page }, testInfo) => {
  await openFresh(page);

  if (testInfo.project.name.includes('mobile')) {
    await page.getByRole('button', { name: 'Toggle details' }).click();
  }

  const nameInput = page.getByTestId('inspector-name');
  await expect(nameInput).toBeVisible();
  await nameInput.focus();
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
  await expect(nameInput).toBeFocused();

  await page.keyboard.press('q');
  await expect(nameInput).toHaveValue(/q$/);
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'false');
});

test('core editor and open Base UI overlays have no serious or critical axe findings', async ({ page }, testInfo) => {
  await openFresh(page);
  await expectNoSeriousAccessibilityViolations(page, 'core editor', '#root');

  if (!testInfo.project.name.includes('mobile')) {
    const fileTrigger = page.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'File', exact: true });
    await fileTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page, 'open File menu', '[data-slot="menubar-content"]');
    await page.keyboard.press('Escape');
  }

  await openCommandPalette(page);
  await expectNoSeriousAccessibilityViolations(page, 'open command palette', '[data-slot="dialog-content"]');
});
