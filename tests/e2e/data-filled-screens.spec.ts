import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Data-filled screens (finish line F2-02, F2-03, F4-06) with SYNTHETIC
 * responses shaped exactly like the existing contracts:
 * /api/forecourt/operations/overview, /api/settlements/summary and
 * /api/settlements/unmatched. No backend field is invented here.
 */

const TENANT = 'tenant-1';
const ENTITY = 'entity-1';
const STATION = 'station-1';

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function mockContext(page: Page, pathname: string) {
  await page.route('**/api/context*', (route) =>
    route.fulfill(
      json({
        data: {
          available: {
            organisations: [
              {
                id: TENANT,
                name: 'Sample organisation',
                legalEntities: [
                  {
                    id: ENTITY,
                    name: 'Sample legal entity',
                    stations: [
                      {
                        id: STATION,
                        code: 'SMP-01',
                        name: 'Sample station',
                        timezone: 'Africa/Harare',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          current: {
            organisationId: TENANT,
            legalEntityId: ENTITY,
            stationId: STATION,
            allStations: false,
          },
          route: {
            pathname,
            policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: false },
          },
          persistedContextInvalid: false,
        },
      }),
    ),
  );
}

const action = { canExecute: false, permissionGranted: true, requiresStepUp: false };

/** Day 11 Oct is still open while the station is on 12 Oct; two shifts; four reconciliations. */
const overview = {
  station: { code: 'SMP-01', name: 'Sample station', timezone: 'Africa/Harare' },
  organisation: { name: 'Sample organisation' },
  currentBusinessDate: '2026-10-12',
  currentBusinessDayId: 'day-2',
  visibility: { reconciliations: true, auditTimeline: true },
  actions: {
    OpenBusinessDay: action,
    CloseBusinessDay: action,
    LockBusinessDay: action,
    StartShift: action,
    CloseMeters: action,
    CompleteShift: action,
  },
  businessDays: [
    {
      id: 'day-1',
      date: '2026-10-11',
      state: 'OPEN',
      version: 3,
      openedAt: '2026-10-11T04:00:00.000Z',
      closedAt: null,
      updatedAt: '2026-10-11T16:00:00.000Z',
    },
  ],
  selectedBusinessDay: {
    id: 'day-1',
    date: '2026-10-11',
    state: 'OPEN',
    version: 3,
    openedAt: '2026-10-11T04:00:00.000Z',
    closedAt: null,
  },
  shifts: [
    {
      id: 'shift-1',
      state: 'OPEN',
      businessDate: '2026-10-11',
      plannedStartAt: '2026-10-11T04:00:00.000Z',
      plannedEndAt: '2026-10-11T12:00:00.000Z',
      version: 2,
      openedAt: '2026-10-11T04:05:00.000Z',
      meterClosedAt: null,
      completedAt: null,
      notOperatedReason: null,
      attendantCount: 2,
    },
    {
      id: 'shift-2',
      state: 'COMPLETED',
      businessDate: '2026-10-11',
      plannedStartAt: '2026-10-11T12:00:00.000Z',
      plannedEndAt: '2026-10-11T20:00:00.000Z',
      version: 5,
      openedAt: '2026-10-11T12:02:00.000Z',
      meterClosedAt: '2026-10-11T19:55:00.000Z',
      completedAt: '2026-10-11T20:01:00.000Z',
      notOperatedReason: null,
      attendantCount: 1,
    },
  ],
  reconciliations: [
    {
      id: 'rec-approved',
      shiftId: 'shift-2',
      state: 'APPROVED',
      version: 4,
      revision: 1,
      revisionState: 'APPROVED',
      updatedAt: '2026-10-11T21:00:00.000Z',
      submittedAt: '2026-10-11T20:30:00.000Z',
      returnedAt: null,
      approvedAt: '2026-10-11T21:00:00.000Z',
      returnReason: null,
    },
    {
      id: 'rec-draft',
      shiftId: 'shift-1',
      state: 'DRAFT',
      version: 1,
      revision: 1,
      revisionState: 'DRAFT',
      updatedAt: '2026-10-11T10:00:00.000Z',
      submittedAt: null,
      returnedAt: null,
      approvedAt: null,
      returnReason: null,
    },
    {
      id: 'rec-review',
      shiftId: 'shift-1',
      state: 'PENDING_APPROVAL',
      version: 2,
      revision: 1,
      revisionState: 'PENDING_APPROVAL',
      updatedAt: '2026-10-11T12:30:00.000Z',
      submittedAt: '2026-10-11T12:30:00.000Z',
      returnedAt: null,
      approvedAt: null,
      returnReason: null,
    },
    {
      id: 'rec-returned',
      shiftId: 'shift-2',
      state: 'RETURNED',
      version: 3,
      revision: 2,
      revisionState: 'RETURNED',
      updatedAt: '2026-10-11T20:45:00.000Z',
      submittedAt: '2026-10-11T20:20:00.000Z',
      returnedAt: '2026-10-11T20:45:00.000Z',
      approvedAt: null,
      returnReason: 'Counted cash does not match the declaration',
    },
  ],
  timeline: [
    {
      eventCode: 'FORECOURT.OpenBusinessDay',
      occurredAt: '2026-10-11T04:00:00.000Z',
      actorName: 'Sample supervisor',
      subjectType: 'business_day',
      reason: null,
    },
  ],
};

async function mockOverview(page: Page) {
  await page.route('**/api/forecourt/operations/overview**', (route) =>
    route.fulfill(json(overview)),
  );
}

async function expectNoSidewaysScroll(page: Page, label: string) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, label).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
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

  test('Provider Settlements shows EcoCash and POS waiting cards and the provider chart', async ({
    page,
  }) => {
    await mockContext(page, `/stations/${STATION}/settlements`);
    const settlement = (input: {
      id: string;
      providerName: string;
      grossAmount: string;
      state: string;
    }) => ({
      settlementId: input.id,
      providerId: `provider-${input.id}`,
      providerCode: input.id.toUpperCase(),
      providerName: input.providerName,
      providerAccountId: `account-${input.id}`,
      accountReference: `MERCHANT-${input.id}`,
      stationId: STATION,
      settlementReference: `REF-${input.id}`,
      batchReference: null,
      transactionDate: '2026-10-10',
      settlementDate: '2026-10-11',
      currency: 'USD',
      grossAmount: input.grossAmount,
      allocatedAmount: '0.0000',
      unallocatedProviderAmount: input.grossAmount,
      expectedEvidenceAmount: '0.0000',
      unmatchedEvidenceAmount: '0.0000',
      providerFeeAmount: null,
      providerDeductionAmount: null,
      reportedNetAmount: null,
      varianceAmount: '0.0000',
      state: input.state,
      version: 1,
    });
    const payment = (id: string, method: 'POS' | 'ECOCASH', amount: string) => ({
      paymentId: id,
      stationId: STATION,
      reconciliationId: 'rec-approved',
      reconciliationState: 'APPROVED',
      businessDate: '2026-10-10',
      method,
      amount,
      reference: `REF-${id}`,
      allocatedAmount: '0.0000',
      unallocatedAmount: amount,
    });
    await page.route('**/api/settlements/summary**', (route) =>
      route.fulfill(
        json([
          settlement({
            id: 'eco',
            providerName: 'EcoCash merchant',
            grossAmount: '75.0000',
            state: 'RECORDED',
          }),
          settlement({
            id: 'pos',
            providerName: 'Zimswitch POS',
            grossAmount: '25.0000',
            state: 'EXCEPTION',
          }),
        ]),
      ),
    );
    await page.route('**/api/settlements/unmatched**', (route) =>
      route.fulfill(
        json([
          payment('p1', 'ECOCASH', '25.5000'),
          payment('p2', 'POS', '40.0000'),
          payment('p3', 'POS', '10.0000'),
        ]),
      ),
    );

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
});
