import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('A11 daily operations entry requires an authorised station-day context', async ({ page }) => {
  await page.goto('/operations/daily');

  await expect(page.getByRole('heading', { name: 'Daily operations', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose a station', level: 2 })).toBeVisible();
  await expect(
    page.getByText('Use the station selector above to choose a station, business date and shift.'),
  ).toBeVisible();
});

test('A11 daily operations entry is mobile-safe and accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/operations/daily');

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.documentWidth).toBe(layout.viewportWidth);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
