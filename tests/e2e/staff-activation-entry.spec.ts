import { expect, test } from '@playwright/test';

test('employees can reach activation from login and return to sign in', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'First time? Activate your account' }).click();
  await expect(page).toHaveURL(/\/join$/);
  await expect(
    page.getByRole('heading', { name: 'Activate your Shanda Fuel account' }),
  ).toBeVisible();
  await expect(page.getByLabel('Activation Code')).toHaveAttribute('placeholder', '7K3M-9R2X');
  await page.getByRole('link', { name: 'Already activated? Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
