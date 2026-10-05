import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('A12 inventory valuation operator surface', () => {
  test('is discoverable through the inventory entry route and explains missing context', async ({
    page,
  }) => {
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/inventory\/valuation$/);
    await expect(page.getByText('Select an authorised organisation and station')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Inventory'),
    ).toBeVisible();
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
