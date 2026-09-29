import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * ADR-015 Product Shell and Owner/Finance Overview. The Overview renders
 * synthetic sample data until the reporting projection exists.
 */

test('overview shows KPIs first, then period charts, then needs attention', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByText('Sample data for design review.')).toBeVisible();
  const headings = page.getByRole('heading', { level: 2 });
  await expect(headings).toHaveText([
    'Today at a glance',
    'Statistics by period',
    'Needs attention',
  ]);
  await expect(page.getByText('Provisional', { exact: false })).toBeVisible();
});

test('period pills drive the charts and keep a text equivalent', async ({ page }) => {
  await page.goto('/');
  const periods = page.getByRole('group', { name: 'Period' });
  await expect(periods.getByRole('button', { name: 'This week' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await periods.getByRole('button', { name: 'Last month' }).click();
  await expect(periods.getByRole('button', { name: 'Last month' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.overview-range')).toHaveText('Sat 1 Aug – Mon 31 Aug 2026');
  await expect(page.locator('caption', { hasText: 'Daily fuel revenue' })).toHaveCount(1);
});

test('needs attention filters and dismisses information items only', async ({ page }) => {
  await page.goto('/');
  const filters = page.getByRole('group', { name: 'Filter items' });
  const table = page.getByRole('table', { name: 'Items that need attention' });

  await filters.getByRole('button', { name: /Info/ }).click();
  await expect(table.getByRole('row')).toHaveCount(3);
  await table.getByRole('button', { name: /Dismiss Bank statement/ }).click();
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(filters.getByRole('button', { name: /All/ })).toHaveText('All 7');

  await filters.getByRole('button', { name: /Exceptions/ }).click();
  await expect(table.getByRole('button', { name: /Dismiss/ })).toHaveCount(0);
});

test('sidebar has grouped navigation, no search box, and collapses', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });

  await expect(sidebar.getByRole('searchbox')).toHaveCount(0);
  await expect(sidebar.getByRole('textbox')).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await sidebar.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'collapsed');
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'collapsed');
  // Keyboard activation: in `next dev` the dev-tools badge overlaps this corner.
  await sidebar.getByRole('button', { name: 'Expand sidebar' }).press('Enter');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'expanded');
});

test('unfinished areas open the work-in-progress dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Deliveries' }).click();
  const dialog = page.getByRole('dialog', { name: 'Deliveries is in progress' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Got it' }).click();
  await expect(dialog).toBeHidden();
});

test('global search opens with the keyboard and navigates', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');

  const search = page.getByRole('combobox', { name: 'Search pages' });
  await expect(search).toBeFocused();
  await search.fill('supp');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/suppliers$/);
});

test('theme toggle in the account pill switches and persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
});

test('phones get the bottom bar and the More sheet instead of the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeHidden();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'More' })
    .click();
  const sheet = page.getByRole('dialog', { name: 'All areas' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Reports' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`overview has no detectable accessibility violations (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test('overview has no detectable accessibility violations at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
