import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('supervisor can review the shift-scoped daily reconciliation workflow', async ({ page }) => {
  await page.goto('/stations/demo-station/reconciliations/new');

  await expect(
    page.getByRole('heading', { name: 'TEI Oils · 20 Sep 2026 · Morning shift' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Server-derived sales' })).toBeVisible();
  await expect(page.getByText('Expected sales', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible();

  await page.getByRole('button', { name: 'Submit for management review' }).click();
  await expect(page.getByText('SUBMITTED', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Approved records are locked; corrections use a new revision'),
  ).toBeVisible();
});

test('daily reconciliation workflow has no detectable accessibility violations', async ({
  page,
}) => {
  await page.goto('/stations/demo-station/reconciliations/new');
  const results = await new AxeBuilder({ page })
    .include('[aria-label="Daily forecourt reconciliation workflow"]')
    .analyze();
  expect(results.violations).toEqual([]);
});
