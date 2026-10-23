import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { mockEmptyWorkContext } from './fixtures/context-route';
import { mockContext, mockOverview, STATION, TENANT } from './fixtures/data-filled';
import { mockReconciliationDetails } from './fixtures/reconciliation-detail';

/**
 * PR #144 final UI corrections, all on SYNTHETIC data: donut contrast,
 * /foundation hydration, navigation/history warnings, the reconciliation
 * statement at phone to desktop widths, and its print output.
 */

const reconciliationsUrl = `/stations/${STATION}/reconciliations?tenantId=${TENANT}`;

async function openReconciliations(page: Page, failIds?: string[]) {
  await mockContext(page, `/stations/${STATION}/reconciliations`);
  await mockOverview(page);
  await mockReconciliationDetails(page, failIds ? { failIds } : {});
  await page.goto(reconciliationsUrl);
  await expect(page.getByRole('heading', { name: 'Shift reconciliations' }).first()).toBeVisible();
}

async function openStatement(page: Page, failIds?: string[]) {
  await openReconciliations(page, failIds);
  await page.getByRole('button', { name: 'View statement' }).click();
  await expect(page.getByRole('heading', { name: 'Reconciliation statement' })).toBeVisible();
  await expect(page.getByText(/^Loading\b/)).toHaveCount(0);
}

test.describe('cash donut', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const width of [320, 1440]) {
      test(`centre text passes contrast (${colorScheme}, ${width}px)`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.setViewportSize({ width, height: 900 });
        await openReconciliations(page);
        const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
        expect(results.violations).toEqual([]);
      });
    }
  }

  test('SVG slices carry no CSS background, so nothing sits behind the centre text', async ({
    page,
  }) => {
    await openReconciliations(page);
    const backgrounds = await page
      .locator('.cash-donut-slice')
      .evaluateAll((slices) => slices.map((slice) => getComputedStyle(slice).backgroundColor));
    expect(backgrounds.length).toBeGreaterThan(0);
    for (const background of backgrounds) expect(background).toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('console hygiene', () => {
  const reactProblems = (messages: string[]) =>
    messages.filter((text) => !/Failed to load resource/.test(text));

  test('/foundation hydrates without mismatches and keeps field semantics', async ({ page }) => {
    const messages: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') messages.push(message.text());
    });
    page.on('pageerror', (error) => messages.push(error.message));
    await mockEmptyWorkContext(page);
    await page.goto('/foundation');
    const note = page.getByLabel('Draft note');
    await expect(note).toHaveAttribute('aria-required', 'true');
    await expect(note).toHaveAttribute('required', '');
    await expect(note).toHaveAttribute('aria-describedby', 'note-hint');
    await expect(page.locator('#reason')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#reason')).toHaveAttribute('aria-describedby', 'reason-error');
    // Let hydration finish before judging the console.
    await page.waitForLoadState('networkidle');
    expect(reactProblems(messages)).toEqual([]);
  });

  test('navigation, back and forward stay in sync without React warnings', async ({ page }) => {
    const messages: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') messages.push(message.text());
    });
    page.on('pageerror', (error) => messages.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockContext(page, '/operations/daily');
    await mockOverview(page);
    await mockReconciliationDetails(page);
    await page.goto(`/operations/daily?tenantId=${TENANT}&stationId=${STATION}`);
    await expect(page.getByRole('heading', { name: 'Shifts', exact: true })).toBeVisible();
    await page.locator('nav a[href^="/stations/"]:visible', { hasText: 'Reconciliations' }).click();
    await expect(page).toHaveURL(/\/reconciliations/);
    await expect(
      page.getByRole('heading', { name: 'Shift reconciliations' }).first(),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/operations\/daily/);
    await expect(page.getByRole('heading', { name: 'Shifts', exact: true })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/reconciliations/);
    await expect(
      page.getByRole('heading', { name: 'Shift reconciliations' }).first(),
    ).toBeVisible();
    expect(reactProblems(messages)).toEqual([]);
  });
});

test.describe('reconciliation statement', () => {
  for (const width of [320, 390, 820, 1440]) {
    test(`fits ${width}px without clipping, with missing figures named`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openStatement(page);

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const clipped = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth + 1;
        return [...document.querySelectorAll('.recon-statement *')]
          .filter((element) => element.getBoundingClientRect().right > limit)
          .map((element) => `${element.tagName}.${element.className}`);
      });
      expect(clipped).toEqual([]);

      // rec-review answers 500: it is listed, and the total says it is partial.
      const summary = page.getByRole('table', { name: 'Statement summary' });
      await expect(summary).toContainText('Not available · figures could not be loaded');
      await expect(summary).toContainText('Total of shifts shown');
      const ledgers = page.locator('.recon-ledger');
      // rec-draft has no cash count: the rows stay and say so.
      await expect(ledgers.filter({ hasText: 'Draft' })).toContainText('Not recorded');
      await expect(page.getByRole('note').first()).toContainText('not counted as zero');

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test('never shows zero totals when no shift figures could be loaded', async ({ page }) => {
    await openStatement(page, ['rec-approved', 'rec-review', 'rec-draft', 'rec-returned']);
    const summary = page.getByRole('table', { name: 'Statement summary' });
    await expect(summary.locator('tfoot')).toContainText('Not available');
    await expect(summary.locator('tfoot')).not.toContainText('0.00');
    await expect(summary.locator('tbody tr[data-missing="true"]')).toHaveCount(4);
  });

  test('print output shows the statement alone, with missing figures marked', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1000 });
    await openStatement(page);
    await page.emulateMedia({ media: 'print' });

    await expect(page.locator('.recon-statement-actions')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Reconciliation statement' })).toBeVisible();
    const shellVisible = await page
      .locator('.shell-body')
      .evaluate((element) => getComputedStyle(element).visibility);
    expect(shellVisible).toBe('hidden');

    const pdf = await page.pdf({ format: 'A4' });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(pages.length).toBeLessThanOrEqual(3);

    const text = await page.locator('.recon-statement').innerText();
    expect(text).toContain('Not available');
    expect(text).toContain('Not recorded');
    expect(text).toContain('Total of shifts shown');
  });
});
