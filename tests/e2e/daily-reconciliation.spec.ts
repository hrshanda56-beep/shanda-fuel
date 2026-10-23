import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockEmptyWorkContext } from './fixtures/context-route';

test.beforeEach(async ({ page }) => {
  await mockEmptyWorkContext(page);
});

test('reconciliation routes do not present synthetic local state without server context', async ({
  page,
}) => {
  await page.goto('/stations/demo-station/reconciliations/new');

  await expect(page.getByRole('heading', { name: 'Choose a station' })).toBeVisible();
  await expect(page.getByText('Use the station selector above to choose a station')).toBeVisible();
  await expect(page.getByText('20 Sep 2026')).not.toBeVisible();
});

test('server-context-required reconciliation state has no detectable accessibility violations', async ({
  page,
}) => {
  await page.goto('/stations/demo-station/reconciliations/new');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
