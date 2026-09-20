import { expect, test } from '@playwright/test';

test('application foundation renders and exposes liveness health', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Engineering foundation ready.' })).toBeVisible();

  const response = await page.request.get('/api/health');
  expect(response.ok()).toBe(true);
  expect((await response.json()).status).toBe('ok');
});
