import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** The overview stays truthful until live reporting data is available. */

test.beforeEach(async ({ page }) => {
  await page.route('**/api/context**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          available: { organisations: [] },
          current: null,
          route: {
            pathname: '/',
            policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: true },
          },
          persistedContextInvalid: false,
        },
      }),
    });
  });
  for (const endpoint of ['reports/management', 'settlements/summary', 'settlements/unmatched']) {
    await page.route(`**/api/${endpoint}**`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Dependency unavailable in shell test' }),
      });
    });
  }
});

test('overview shows calm unavailable states without synthetic figures', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(
    page.getByText('Live figures appear as operational evidence is recorded.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Keep today moving',
    'Review today’s evidence',
    'Today at a glance',
    'Statistics by period',
    'Needs attention',
    'Recent activity',
  ]);
  await expect(page.getByText('Sample data for design review.', { exact: false })).toHaveCount(0);
  await expect(page.locator('.metric-card')).toHaveCount(0);
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

  await page.getByRole('button', { name: 'Search pages' }).click();
  await expect(page.getByRole('combobox', { name: 'Search pages' })).toBeFocused();
  await page.keyboard.press('Escape');

  await sidebar
    .getByRole('button', { name: 'Collapse sidebar' })
    .evaluate((button) => (button as HTMLButtonElement).click());
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
