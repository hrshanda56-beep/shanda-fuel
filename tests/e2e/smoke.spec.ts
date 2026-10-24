import { expect, test } from '@playwright/test';
import { mockEmptyWorkContext } from './fixtures/context-route';

test.beforeEach(async ({ page }) => {
  await mockEmptyWorkContext(page);
});

test('application foundation renders and exposes liveness health', async ({ page }) => {
  await page.goto('/foundation');
  await expect(page.getByRole('heading', { name: 'Good morning, Demo user' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.getByText('Offline draft mode')).toBeVisible();

  const response = await page.request.get('/api/health');
  expect(response.ok()).toBe(true);
  expect((await response.json()).status).toBe('ok');
});

test('foundation exposes mobile navigation and labelled controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/foundation');

  // Phones get a bottom bar; the grouped navigation opens from More.
  await expect(page.getByRole('button', { name: 'More' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
  const mobileContext = page.getByRole('group', { name: 'Work context' });
  await expect(mobileContext).toContainText('Demo organisation');
  await expect(mobileContext).toContainText('Demo station');
  await expect(mobileContext).toContainText('20 Sep 2026');
  await expect(mobileContext).toContainText('Morning shift');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeAttached();

  await page.getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('dialog', { name: 'More' });
  await expect(menu.getByRole('button', { name: /Demo station/ })).toBeVisible();
  await expect(menu.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute('href', '/');
});

// The shared form, dialog and sheet patterns are exercised on the internal
// design-system reference (served by `next dev`, which Playwright uses).
test('form fields keep persistent labels and mark required state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/design-system');

  const reference = page.getByRole('textbox', { name: 'Reference', exact: true });
  await expect(reference).toBeVisible();
  await expect(reference).toHaveAttribute('required', '');
  await expect(reference).toHaveAttribute('aria-required', 'true');
  await expect(page.locator('#ref-reason')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#ref-litres')).not.toHaveAttribute('required');
});

test('shared button defaults and modal triggers do not submit forms accidentally', async ({
  page,
}) => {
  await page.goto('/design-system');

  await expect(page.getByRole('button', { name: 'Open accessible dialog' })).toHaveAttribute(
    'type',
    'button',
  );
  await expect(page.getByRole('button', { name: 'Open mobile sheet' })).toHaveAttribute(
    'type',
    'button',
  );
});

test('accessible dialog traps focus, closes with Escape, and restores focus', async ({ page }) => {
  await page.goto('/design-system');
  const trigger = page.getByRole('button', { name: 'Open accessible dialog' });
  await trigger.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Confirm return' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Confirm return' })).toBeVisible();
  const hiddenPage = page
    .locator('#main-content')
    .locator('xpath=ancestor::*[@aria-hidden="true"]');
  await expect(hiddenPage).toHaveCount(1);

  await page.keyboard.press('Tab');
  await expect(dialog.locator(':focus')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator(':focus')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(hiddenPage).toHaveCount(0);
});

test('bottom sheet exposes modal semantics and keyboard close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/design-system');
  await page.getByRole('button', { name: 'Open mobile sheet' }).click();

  const sheet = page.getByRole('dialog', { name: 'Quick context' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  await sheet.getByRole('button', { name: 'Close Quick context' }).click();
  await expect(sheet).toBeHidden();
});
