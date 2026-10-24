import { expect, test } from '@playwright/test';

test('tablet rail opens labeled navigation and Escape restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 1113, height: 681 });
  await page.route('**/api/**', (route) =>
    route.request().url().includes('/api/clerk')
      ? route.continue()
      : route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/reports?tenantId=t-1&stationId=s-1');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
  const trigger = page.getByRole('button', { name: 'Expand menu', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Navigation', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await dialog.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
