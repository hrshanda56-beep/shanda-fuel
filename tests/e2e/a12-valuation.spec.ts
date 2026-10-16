import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('A12 inventory valuation operator surface', () => {
  test('is discoverable through the inventory entry route and explains missing context', async ({
    page,
  }) => {
    await page.goto('/inventory');
    await page.waitForURL(/\/inventory\/valuation$/);
    await expect(
      page.getByRole('heading', { name: 'Choose a station to view inventory', level: 2 }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Inventory', level: 1 })).toBeVisible();
  });

  test('the inventory entry route keeps the work context it was given', async ({ page }) => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const stationId = '22222222-2222-4222-8222-222222222222';
    await page.goto(`/inventory?tenantId=${tenantId}&stationId=${stationId}&ignored=1`);
    await expect(page).toHaveURL(
      new RegExp(`/inventory/valuation\\?tenantId=${tenantId}&stationId=${stationId}$`),
    );
  });

  test('valuation entry state has no detectable accessibility violations and supports keyboard focus', async ({
    page,
  }) => {
    await page.goto('/inventory/valuation');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
