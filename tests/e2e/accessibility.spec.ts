import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('foundation page has no detectable accessibility violations', async ({ page }) => {
  await page.goto('/foundation');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('foundation honors reduced motion preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // The loading indicator is shown on the design-system reference.
  await page.goto('/design-system');

  await expect(page.locator('.loading-dot')).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');
});

test('foundation remains accessible with dark system preference', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/foundation');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('mobile shell remains accessible with valid navigation semantics', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/foundation');

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

// /design-system is an internal, development-only route (404 in production
// builds; see src/design-system/reference/availability.ts). Playwright runs
// against `next dev` via playwright.config.ts, locally and in CI.
test.describe('design-system foundation reference', () => {
  test('has no detectable accessibility violations in light theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/design-system');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('has no detectable accessibility violations in dark theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/design-system');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('has no detectable accessibility violations at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/design-system');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('confirmation dialog starts on the safe action and restores focus', async ({ page }) => {
    await page.goto('/design-system');
    const trigger = page.getByRole('button', { name: 'Reverse receipt' });
    await trigger.click();

    const dialog = page.getByRole('alertdialog', { name: 'Reverse this receipt?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Reverse receipt' })).toBeDisabled();

    const results = await new AxeBuilder({ page }).include('[role="alertdialog"]').analyze();
    expect(results.violations).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('confirmation acknowledgement resets for every opening', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/design-system');
    // Wait for hydration: the server renders "System (light)"; "System (dark)"
    // only appears once client code has run.
    await expect(page.getByLabel('Theme').locator('option[value="system"]')).toHaveText(
      'System (dark)',
    );
    const trigger = page.getByRole('button', { name: 'Reverse receipt' });
    const dialog = page.getByRole('alertdialog', { name: 'Reverse this receipt?' });
    const acknowledgement = dialog.getByLabel('I understand this posts a reversal.');
    const confirm = dialog.getByRole('button', { name: 'Reverse receipt' });

    await trigger.click();
    await acknowledgement.check();
    await confirm.click();
    // The reference page closes the dialog itself once the simulated command completes.
    await expect(dialog).toBeHidden();

    await trigger.click();
    await expect(acknowledgement).not.toBeChecked();
    await expect(confirm).toBeDisabled();
  });

  test('manual theme override persists and wins over the system preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/design-system');
    const theme = page.getByLabel('Theme');
    // The server renders "System (light)"; the resolved system theme only
    // appears after hydration, when the select's change handler is attached.
    await expect(theme.locator('option[value="system"]')).toHaveText('System (dark)');
    await theme.selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(230, 236, 234)');
  });
});
