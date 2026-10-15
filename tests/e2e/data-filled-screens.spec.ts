import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  mockContext,
  mockOverview,
  mockSettlements,
  STATION,
  TENANT,
} from './fixtures/data-filled';

/**
 * Data-filled screens (finish line F2-02, F2-03, F4-06) with SYNTHETIC
 * responses shaped exactly like the existing contracts:
 * /api/forecourt/operations/overview, /api/settlements/summary and
 * /api/settlements/unmatched. No backend field is invented here.
 */

async function expectNoSidewaysScroll(page: Page, label: string) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, label).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
}

/**
 * Words that the browser broke across lines inside the matched elements, e.g.
 * a status reading "App / rov / ed". Each word must lay out on one line.
 */
async function wordsSplitAcrossLines(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) => {
    const broken: string[] = [];
    for (const element of elements) {
      if (!(element as HTMLElement).offsetParent) continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (const match of text.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index ?? 0);
          range.setEnd(node, (match.index ?? 0) + match[0].length);
          const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
          if (tops.size > 1) broken.push(match[0]);
        }
      }
    }
    return broken;
  });
}

test.describe('data-filled screens', () => {
  test('Daily Operations shows shifts, sourced alerts and activity', async ({ page }) => {
    await mockContext(page, '/operations/daily');
    await mockOverview(page);
    for (const width of [390, 803, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/operations/daily?tenantId=${TENANT}&stationId=${STATION}`);

      const glance = page.getByLabel('Today at a glance');
      await expect(glance, `width ${width}`).toContainText('2 · 1 open');
      await expect(glance).toContainText('Waiting for review');
      await expect(glance).toContainText('Returned for changes');

      await expect(page.getByRole('heading', { name: 'Shifts', exact: true })).toBeVisible();
      const attention = page.locator('section[aria-labelledby="operations-attention-title"]');
      await expect(attention).toContainText('Business day 11 Oct 2026 is still open');
      await expect(attention).toContainText('Reconciliation returned for changes');
      await expect(attention).toContainText('Counted cash does not match the declaration');
      await expect(attention).toContainText('Reconciliation waiting for review');
      await expect(page.locator('section[aria-labelledby="timeline-title"]')).toContainText(
        'Open business day',
      );

      await expectNoSidewaysScroll(page, `width ${width}`);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, `width ${width}`).toEqual([]);
    }
  });

  test('Reconciliations lead with exceptions and filter without hiding data', async ({ page }) => {
    await mockContext(page, `/stations/${STATION}/reconciliations`);
    await mockOverview(page);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/stations/${STATION}/reconciliations?tenantId=${TENANT}`);

      const glance = page.getByLabel('Reconciliations at a glance');
      await expect(glance, `width ${width}`).toContainText('In draft');
      await expect(glance).toContainText('Approved');

      const rows = page.locator('.reconciliation-row');
      // Needs action (default): returned first, then waiting for review; no draft/approved.
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toHaveAttribute('data-state', 'RETURNED');
      await expect(rows.nth(0)).toContainText('Counted cash does not match the declaration');
      await expect(rows.nth(1)).toHaveAttribute('data-state', 'PENDING_APPROVAL');
      await expect(rows.nth(0).getByRole('link', { name: 'Open workspace' })).toHaveAttribute(
        'href',
        /\/operations\/daily\?.*businessDayId=day-1.*shiftId=shift-2/,
      );
      await expect(rows.nth(1).getByRole('link', { name: 'Review' })).toHaveAttribute(
        'href',
        /\/operations\/reconciliations\/rec-review\/review\?/,
      );

      const filter = page.getByRole('group', { name: 'Show reconciliations' });
      await filter.getByRole('button', { name: 'All' }).click();
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(2)).toHaveAttribute('data-state', 'DRAFT');
      await expect(rows.nth(3)).toHaveAttribute('data-state', 'APPROVED');
      await expect(filter.getByRole('button', { name: 'All' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      await expectNoSidewaysScroll(page, `width ${width}`);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, `width ${width}`).toEqual([]);
    }
  });

  test('Provider settlements shows EcoCash and POS waiting cards and the provider chart', async ({
    page,
  }) => {
    await mockContext(page, `/stations/${STATION}/settlements`);
    await mockSettlements(page);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/stations/${STATION}/settlements?tenantId=${TENANT}`);
      const summary = page.getByLabel('Settlement summary');
      const eco = summary.locator('div', { hasText: 'EcoCash waiting to match' });
      await expect(eco, `width ${width}`).toContainText('USD 25.50');
      await expect(eco).toContainText('1 payment');
      const pos = summary.locator('div', { hasText: 'POS (card) waiting to match' });
      await expect(pos).toContainText('USD 50.00');
      await expect(pos).toContainText('2 payments');
      await expect(summary.locator('div', { hasText: 'Settlements not reconciled' })).toContainText(
        '2',
      );
      await expect(summary.locator('div', { hasText: 'Exceptions' })).toContainText('1');

      const chart = page.locator('section[aria-labelledby="settled-by-provider-title"]');
      await expect(chart.getByRole('heading', { name: 'Settled by provider' })).toBeVisible();
      await expect(chart).toContainText('EcoCash merchant');
      await expect(chart).toContainText('USD 75.00 · 75%');
      await expect(chart).toContainText('Zimswitch POS');
      await expect(chart).toContainText('USD 25.00 · 25%');

      await expectNoSidewaysScroll(page, `width ${width}`);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, `width ${width}`).toEqual([]);
    }
  });

  test('status labels, dates and amounts never split mid-word', async ({ page }) => {
    for (const width of [803, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });

      await mockContext(page, '/operations/daily');
      await mockOverview(page);
      await page.goto(`/operations/daily?tenantId=${TENANT}&stationId=${STATION}`);
      await expect(page.getByRole('heading', { name: 'Shifts', exact: true })).toBeVisible();
      await expect(page.locator('.status').first()).toBeVisible();
      expect(await wordsSplitAcrossLines(page, '.status'), `daily ops ${width}`).toEqual([]);

      await mockContext(page, `/stations/${STATION}/settlements`);
      await mockSettlements(page);
      await page.goto(`/stations/${STATION}/settlements?tenantId=${TENANT}`);
      await expect(page.getByLabel('Settlement summary')).toContainText('USD 25.50');
      await expect(page.locator('td[data-label="Dates"]').first()).toBeVisible();
      expect(
        await wordsSplitAcrossLines(page, '.status, td.numeric, td .numeric'),
        `settlements ${width}`,
      ).toEqual([]);
      await expectNoSidewaysScroll(page, `settlements ${width}`);

      if (width >= 1440) {
        // Desktop: the settlement table keeps its Action column in view.
        const settlements = page.locator('.responsive-table-wrap', {
          has: page.getByRole('columnheader', { name: 'Action' }),
        });
        const hidden = await settlements.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        );
        expect(hidden, `settlement table ${width}`).toBeLessThanOrEqual(0);
      }

      if (width >= 1024) {
        // The matching table spans the row, so no column hides behind its scroll.
        const region = page.locator('.responsive-table-wrap', {
          has: page.getByRole('columnheader', { name: 'Remaining' }),
        });
        const overflow = await region.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        );
        expect(overflow, `matching table ${width}`).toBeLessThanOrEqual(0);
        await expect(region.getByRole('columnheader', { name: 'Remaining' })).toBeVisible();
      }
    }
  });
});
