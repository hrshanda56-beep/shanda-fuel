import { expect, test } from '@playwright/test';

test('application foundation renders and exposes liveness health', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Good morning, Demo user' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.getByText('Offline draft mode')).toBeVisible();

  const response = await page.request.get('/api/health');
  expect(response.ok()).toBe(true);
  expect((await response.json()).status).toBe('ok');
});

test('foundation exposes mobile navigation and labelled controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  const mobileContext = page.getByRole('region', { name: 'Active mobile work context' });
  await expect(mobileContext).toContainText('Demo organisation');
  await expect(mobileContext).toContainText('Demo station');
  await expect(mobileContext).toContainText('20 Sep 2026');
  await expect(mobileContext).toContainText('Morning shift');
  await expect(page.getByLabel('Draft note')).toBeVisible();
  await expect(page.getByLabel('Reason')).toBeVisible();
  await expect(page.getByLabel('Draft note')).toHaveAttribute('required', '');
  await expect(page.getByLabel('Draft note')).toHaveAttribute('aria-required', 'true');
  await expect(page.getByLabel('Quantity')).not.toHaveAttribute('required');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeAttached();
  await expect(
    page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link'),
  ).toHaveText(['Home', 'Tasks', 'Work', 'More']);
});

test('accessible dialog traps focus, closes with Escape, and restores focus', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Open accessible dialog' });
  await trigger.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Confirm return' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Confirm return' })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('aria-hidden', 'true');

  await page.keyboard.press('Tab');
  await expect(dialog.locator(':focus')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator(':focus')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator('.app-shell')).not.toHaveAttribute('aria-hidden', 'true');
});

test('bottom sheet exposes modal semantics and keyboard close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open mobile sheet' }).click();

  const sheet = page.getByRole('dialog', { name: 'Quick context' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  await sheet.getByRole('button', { name: 'Close Quick context' }).click();
  await expect(sheet).toBeHidden();
});
