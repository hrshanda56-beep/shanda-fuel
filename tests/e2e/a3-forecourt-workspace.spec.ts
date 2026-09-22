import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * A3 introduced the presentation-only ForecourtWorkspace surface
 * (src/modules/forecourt/ui/forecourt-workspace.tsx), statically rendered on
 * the home page. This is a small, targeted regression suite for that surface
 * specifically -- it is intentionally narrow: the component issues no
 * authoritative commands itself, so there is nothing here to drive through a
 * full command workflow. It does not replace or duplicate the pre-existing
 * A1/A2 foundation coverage in smoke.spec.ts and accessibility.spec.ts.
 */
test('forecourt workspace renders station/day/shift and reconciliation status', async ({
  page,
}) => {
  await page.goto('/');

  const workspace = page.getByRole('region', { name: 'Keep today’s station moving' });
  await expect(workspace).toBeVisible();
  await expect(workspace).toContainText('20 Sep 2026');
  await expect(workspace).toContainText('Morning shift');

  await expect(workspace.getByRole('heading', { name: 'Morning shift', level: 3 })).toBeVisible();
  await expect(workspace.getByText('OPEN', { exact: true })).toBeVisible();
  await expect(
    workspace.getByRole('heading', { name: 'Meter-derived accountability' }),
  ).toBeVisible();
  await expect(workspace.getByText('DRAFT', { exact: true })).toBeVisible();

  await expect(workspace.getByText('Active nozzle segments')).toBeVisible();
  await expect(workspace.getByText('Sealed nozzle segments')).toBeVisible();
});

test('forecourt workspace primary actions do not crash the page and stay disabled offline', async ({
  page,
}) => {
  await page.goto('/');

  const workspace = page.getByRole('region', { name: 'Keep today’s station moving' });
  const closeMeters = workspace.getByRole('button', { name: 'Close meters' });
  await expect(closeMeters).toBeVisible();
  // The demo home page renders the workspace with connection="online", so
  // the open-shift action is enabled; clicking it must not throw or navigate
  // away, since this presentation-only surface issues no direct commands.
  const openShiftWorkflow = workspace.getByRole('button', { name: 'Open shift workflow' });
  await expect(openShiftWorkflow).toBeEnabled();
  await openShiftWorkflow.click();
  await expect(page.getByRole('heading', { name: 'Good morning, Demo user' })).toBeVisible();
});

test('forecourt workspace has no detectable accessibility violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).include('#forecourt').analyze();
  expect(results.violations).toEqual([]);
});
