import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.skip(process.env.OWNER_DEMO_E2E !== '1', 'Run through the dedicated owner-demo config.');

test('owner can complete the browser-local operational walkthrough and reset it', async ({
  page,
}) => {
  const contextRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/context')) contextRequests.push(request.url());
  });

  await page.goto('/owner-demo');
  await expect(page.getByRole('heading', { name: 'Sign in to the owner demo' })).toBeVisible();
  await page.getByLabel('Demo password').fill('synthetic-owner-demo-password');
  await page.getByRole('button', { name: 'Open owner demo' }).click();
  await expect(page.getByTestId('owner-demo-workspace')).toBeVisible();
  expect(contextRequests).toEqual([]);
  await expect(
    page.getByRole('heading', { name: 'How is the operation performing today?' }),
  ).toBeVisible();
  await expect(page.getByText('T.E.I Oils · Triumph Energy')).toBeVisible();

  await page.getByLabel('Active station').selectOption('gazebo');
  await expect(page.getByText('Today’s sales').locator('..')).toContainText('$9,430.25');
  await page.getByRole('button', { name: 'Sales' }).click();
  await expect(page.getByRole('heading', { name: 'Sales · Gazebo' })).toBeVisible();
  await page.getByRole('button', { name: 'Cash & reconciliation' }).click();
  await expect(page.getByRole('heading', { name: 'Shift/day close status' })).toBeVisible();
  await page.getByRole('button', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Station summary' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Bindura' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to the owner demo' })).toBeVisible();
});

test('owner-demo critical surface has no detectable accessibility violations', async ({ page }) => {
  await page.goto('/owner-demo');
  await page.getByLabel('Demo password').fill('synthetic-owner-demo-password');
  await page.getByRole('button', { name: 'Open owner demo' }).click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
