import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** ADR-015 owner overview: synthetic data is labelled and presentation-only. */

test('overview shows KPIs first, then period charts, then needs attention', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByText('Sample data for design review.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Today at a glance',
    'Statistics by period',
    'Needs attention',
  ]);
  await expect(page.getByText('Provisional', { exact: false })).toBeVisible();
});

test('period pills drive charts and keep a text equivalent', async ({ page }) => {
  await page.goto('/');
  const periods = page.getByRole('group', { name: 'Period' });
  await expect(periods.getByRole('button', { name: 'This week' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await periods.getByRole('button', { name: 'Last month' }).click();
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

test('owner shell keeps grouped navigation, collapse, and global search', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  const nav = sidebar.getByRole('navigation', { name: 'Primary navigation' });

  await expect(nav.getByRole('link', { name: 'Today', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Operations' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
  await expect(sidebar.getByRole('searchbox')).toHaveCount(0);

  await page.getByRole('button', { name: 'Search anything' }).click();
  await expect(page.getByRole('combobox', { name: 'Search pages' })).toBeFocused();
  await page.keyboard.press('Escape');

  await sidebar.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'collapsed');
});

test('overview remains accessible at desktop and phone widths', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }
});
