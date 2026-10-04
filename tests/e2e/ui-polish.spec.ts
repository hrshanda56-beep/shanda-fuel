import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Product polish guarantees that span every screen:
 * - phones never scroll sideways, including screens full of data;
 * - KPIs carry no icons, and KPIs with a detail view link to it;
 * - whole rows and attention items are click targets;
 * - anything clickable shows the pointer cursor on desktop.
 *
 * Data screens load from the API in the browser, so their data states are
 * exercised with synthetic API responses. Nothing here needs a database.
 */

const PHONE_WIDTHS = [320, 390] as const;

const report = {
  report: 'MANAGEMENT_OVERVIEW',
  state: 'POSTED',
  currency: 'USD',
  filters: { tenantId: 'tenant-1', fromDate: '2026-09-01', toDate: '2026-09-30' },
  dateBasis: {},
  stations: [{ stationId: 'station-1', code: 'HRE-01', name: 'Harare Road Service Station' }],
  sales: {
    litresSold: '184250.375',
    salesValue: '1234567.89',
    approvedReconciliationCount: 42,
    salesVariance: '-125.50',
    payments: [
      { method: 'CASH', amount: '734567.89', evidenceIds: [] },
      { method: 'POS', amount: '500000.00', evidenceIds: [] },
    ],
    rows: [
      {
        businessDate: '2026-09-20',
        stationId: 'station-1',
        stationCode: 'HRE-01',
        productId: 'product-1',
        productCode: 'ULP95',
        productName: 'Unleaded petrol 95 octane',
        litres: '92125.188',
        salesValue: '617283.95',
        averageRealizedPrice: '6.70',
        variance: '0',
        reconciliationIds: ['r-1', 'r-2'],
      },
      {
        businessDate: '2026-09-20',
        stationId: 'station-1',
        stationCode: 'HRE-01',
        productId: 'product-2',
        productCode: 'D50',
        productName: 'Diesel 50 ppm',
        litres: '92125.187',
        salesValue: '617283.94',
        averageRealizedPrice: null,
        variance: '0',
        reconciliationIds: ['r-3'],
      },
    ],
    reconciliationIds: [],
  },
  cash: {
    cashEvidence: '734567.89',
    collected: '720000.00',
    awaitingCollection: '14567.89',
    banked: '650000.00',
    collectedButNotBanked: '70000.00',
    cashVariance: '-125.50',
    collectionIds: ['c-1'],
    depositIds: ['d-1'],
  },
  providers: {
    paymentEvidence: '500000.00',
    settlementGross: '498000.00',
    allocatedAmount: '490000.00',
    unallocatedProviderAmount: '8000.00',
    unmatchedEvidenceAmount: '10000.00',
    settlementVariance: '0',
    feesAndDeductions: '2000.00',
    rows: [],
  },
  suppliers: {
    invoiceValue: '900000.00',
    creditNoteValue: '15000.00',
    payments: '700000.00',
    outstandingBalance: '185000.00',
    rows: [],
  },
  customers: {
    availability: 'AVAILABLE',
    receivableBalance: '45210.00',
    prepaidValueBalance: '12000.00',
    reservedAmount: '300.00',
    reservedLitres: '0',
    rows: [],
  },
  inventory: {
    expectedLitres: '410250.500',
    physicalLitres: '409980.250',
    varianceLitres: '-270.250',
    deliveryLitres: '380000.000',
    deliveryValue: '2250000.00',
    rows: [],
  },
  expenses: { total: '3120.40', rows: [] },
  revenue: { recognizedRevenue: '1230000.00' },
  costing: { costingStatus: 'COMPLETE' },
  grossMargin: '210450.25',
};

const settlements = [
  {
    settlementId: 'settlement-1',
    providerId: 'provider-1',
    providerCode: 'ZSWITCH',
    providerName: 'Zimswitch POS acquiring services',
    providerAccountId: 'account-1',
    accountReference: 'MERCHANT-001',
    stationId: 'station-1',
    settlementReference: 'ZSW-2026-09-20-000123456789',
    batchReference: 'BATCH-001',
    transactionDate: '2026-09-20',
    settlementDate: '2026-09-22',
    currency: 'USD',
    grossAmount: '498000.00',
    allocatedAmount: '490000.00',
    unallocatedProviderAmount: '8000.00',
    expectedEvidenceAmount: '490000.00',
    unmatchedEvidenceAmount: '10000.00',
    providerFeeAmount: '1500.00',
    providerDeductionAmount: '500.00',
    reportedNetAmount: '496000.00',
    varianceAmount: '8000.00',
    state: 'PARTIALLY_MATCHED',
    version: 1,
  },
];

const unmatched = [
  {
    paymentId: 'payment-0000-1111-2222-333344445555',
    stationId: 'station-1',
    reconciliationId: 'reconciliation-1',
    reconciliationState: 'APPROVED',
    method: 'POS',
    businessDate: '2026-09-20',
    amount: '10000.00',
    reference: 'POS-2026-09-20-0001',
    allocatedAmount: '0.00',
    unallocatedAmount: '10000.00',
  },
];

const cashSummary = {
  totals: {
    availableAtStation: '14567.89',
    collectedButUnbanked: '70000.00',
    pendingBankConfirmation: '20000.00',
  },
  collections: [
    {
      collectionId: 'collection-1',
      collectionReference: 'COL-HRE01-2026-09-20-MORNING-000042',
      amount: '720000.00',
      allocatedAmount: '720000.00',
      collectedButUnbanked: '70000.00',
      custodyState: 'IN_TRANSIT_TO_BANK',
      currentLocationId: 'location-1',
    },
  ],
};

const suppliers = [
  {
    supplierId: 'supplier-1',
    code: 'SUP-0001',
    legalName: 'Zimbabwe National Fuel Distribution Company (Private) Limited',
    current: '120000.00',
    overdue: '65000.00',
    total: '185000.00',
  },
];

const supplierContext = {
  data: {
    available: {
      organisations: [
        {
          id: 'tenant-1',
          name: 'ShandaHR',
          legalEntities: [{ id: 'entity-1', name: 'TEI Oils', stations: [] }],
        },
      ],
    },
    current: {
      organisationId: 'tenant-1',
      legalEntityId: 'entity-1',
      allStations: true,
    },
    route: {
      pathname: '/suppliers',
      policy: { legalEntity: 'required', station: 'optional', allStationsAllowed: true },
    },
    persistedContextInvalid: false,
  },
};

const valuation = {
  capabilities: { request: true, approve: false, post: false },
  streams: [
    {
      station: { id: 'station-1', code: 'HRE-01', name: 'Harare Road' },
      tank: { id: 'tank-1', code: 'TANK-ULP95-UNDERGROUND-01' },
      product: { id: 'product-1', code: 'ULP95', name: 'Unleaded petrol 95 octane' },
      quantityLitres: '24380.500',
      valuationStatus: 'VALUED',
      inventoryValue: '163349.35',
      weightedAverageCost: '6.7000',
      currency: 'USD',
      lastValuationOrCostEventAt: '2026-09-20T08:00:00Z',
      lastCostEventId: 'cost-event-1',
      projectionVersion: 7,
      blockingReason: null,
      sourceMovementRequiringCost: null,
      activeRevaluation: { id: 'revaluation-1', status: 'REQUESTED', requestedAt: null },
      hasActiveRevaluation: true,
    },
    {
      station: { id: 'station-1', code: 'HRE-01', name: 'Harare Road' },
      tank: { id: 'tank-2', code: 'TANK-D50-UNDERGROUND-02' },
      product: { id: 'product-2', code: 'D50', name: 'Diesel 50 ppm' },
      quantityLitres: '18000.000',
      valuationStatus: 'UNVALUED',
      inventoryValue: null,
      weightedAverageCost: null,
      currency: null,
      lastValuationOrCostEventAt: null,
      lastCostEventId: null,
      projectionVersion: 2,
      blockingReason: 'A receipt has no authoritative cost yet.',
      sourceMovementRequiringCost: null,
      activeRevaluation: null,
      hasActiveRevaluation: false,
    },
  ],
  revaluations: [
    {
      id: 'revaluation-1',
      status: 'REQUESTED',
      reason: 'Late supplier invoice',
      station: { id: 'station-1', code: 'HRE-01', name: 'Harare Road' },
      tank: { id: 'tank-1', code: 'TANK-ULP95-UNDERGROUND-01' },
      product: { id: 'product-1', code: 'ULP95', name: 'Unleaded petrol 95 octane' },
      source: { type: 'DELIVERY_RECEIPT', id: 'receipt-1' },
      amount: '1250.00',
      currency: 'USD',
      effectiveAt: '2026-09-18T06:00:00Z',
      businessDate: '2026-09-18',
      requestedBy: { id: 'user-1', name: 'Inventory controller' },
      requestedAt: '2026-09-20T09:30:00Z',
      approvedBy: null,
      approvedAt: null,
      postedBy: null,
      postedAt: null,
      replayFingerprint: null,
      affectedSales: 14,
    },
  ],
};

async function mockApis(page: Page) {
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  await page.route('**/api/context*', (route) =>
    route.fulfill(
      json({
        data: {
          available: {
            organisations: [
              {
                id: 'tenant-1',
                name: 'Test organisation',
                legalEntities: [
                  {
                    id: 'entity-1',
                    name: 'Test legal entity',
                    stations: [
                      {
                        id: 'station-1',
                        code: 'TEST-01',
                        name: 'Test station',
                        timezone: 'Africa/Harare',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          current: {
            organisationId: 'tenant-1',
            legalEntityId: 'entity-1',
            stationId: 'station-1',
            allStations: false,
          },
          route: {
            pathname: '/stations/station-1/settlements',
            policy: { legalEntity: 'required', station: 'required', allStationsAllowed: false },
          },
          persistedContextInvalid: false,
        },
      }),
    ),
  );
  await page.route('**/api/reports/management**', (route) => route.fulfill(json(report)));
  await page.route('**/api/settlements/summary**', (route) => route.fulfill(json(settlements)));
  await page.route('**/api/settlements/unmatched**', (route) => route.fulfill(json(unmatched)));
  await page.route('**/api/cash/summary**', (route) => route.fulfill(json(cashSummary)));
  await page.route('**/api/context**', (route) => route.fulfill(json(supplierContext)));
  await page.route('**/api/suppliers/summary**', (route) => route.fulfill(json(suppliers)));
  await page.route('**/api/inventory/valuation?**', (route) => route.fulfill(json(valuation)));
}

/**
 * Anything the user would have to scroll sideways to see: visible elements
 * past the viewport edge, and regions that scroll horizontally inside the
 * page. Content hidden on purpose (visually hidden, clipped to 1px) is skipped.
 */
async function sidewaysOverflow(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const hiddenOnPurpose = (element: Element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        if (style.clip !== 'auto' || style.clipPath !== 'none') return true;
        if (box.width <= 1 || box.height <= 1) return true;
      }
      return false;
    };
    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()}.${element.getAttribute('class') ?? ''}`;
    const offenders: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      const box = element.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      const style = getComputedStyle(element);
      const scrollContainer = element.closest<HTMLElement>('.pill-group');
      if (scrollContainer && getComputedStyle(scrollContainer).overflowX === 'auto') continue;
      const scrolls =
        /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
      const pastEdge = box.right > width + 1 || box.left < -1;
      if ((scrolls || pastEdge) && !hiddenOnPurpose(element)) {
        offenders.push(
          `${describe(element)} ${scrolls ? 'scrolls sideways' : `ends at ${Math.round(box.right)}px`}`,
        );
      }
    }
    return {
      width,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: offenders.slice(0, 10),
    };
  });
}

async function expectFitsWidth(page: Page) {
  const result = await sidewaysOverflow(page);
  expect(result.offenders, `elements wider than ${result.width}px`).toEqual([]);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.width);
}

async function cursorOver(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('target is not visible');
  return page.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x!, y!);
      return element ? getComputedStyle(element).cursor : null;
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
}

test.describe('phones never scroll sideways', () => {
  const routes = [
    '/',
    '/login',
    '/reports',
    '/operations/daily',
    '/inventory/valuation',
    '/suppliers',
    '/stations/demo-station/cash',
    '/stations/demo-station/settlements',
    '/no-such-page',
  ];

  for (const width of PHONE_WIDTHS) {
    test(`empty and entry states fit ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const route of routes) {
        await page.goto(route);
        await expect(page.locator('h1').first(), route).toBeVisible();
        await expectFitsWidth(page);
      }
    });

    test(`data-heavy screens fit ${width}px`, async ({ page }) => {
      await mockApis(page);
      await page.setViewportSize({ width, height: 800 });

      await page.goto('/reports?tenantId=tenant-1');
      await expect(page.getByRole('heading', { name: 'Payments and products' })).toBeVisible();
      await expectFitsWidth(page);

      await page.goto('/stations/station-1/settlements?tenantId=tenant-1');
      await expect(page.getByRole('table').getByText('ZSW-2026-09-20-000123456789')).toBeVisible();
      await expectFitsWidth(page);

      await page.goto('/stations/station-1/cash?tenantId=tenant-1');
      await expect(page.getByText('COL-HRE01-2026-09-20-MORNING-000042')).toBeVisible();
      await expectFitsWidth(page);

      await page.goto('/inventory/valuation?tenantId=tenant-1&stationId=station-1');
      await expect(
        page.getByRole('heading', { name: 'Inventory needs a station context' }),
      ).toBeVisible();
      await expectFitsWidth(page);

      await page.goto('/suppliers?tenantId=tenant-1&legalEntityId=entity-1');
      await expect(page.getByText(/Zimbabwe National Fuel Distribution/)).toBeVisible();
      await expectFitsWidth(page);
    });
  }

  test('tables stack into label/value rows on phones', async ({ page }) => {
    await mockApis(page);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/stations/station-1/cash?tenantId=tenant-1');
    const table = page.getByRole('table', { name: 'Station cash collections' });
    await expect(table).toBeVisible();
    await expect(table.locator('thead')).toHaveCSS('position', 'absolute');
    await expect(table.locator('tbody td').first()).toHaveCSS('display', 'block');
  });
});

test.describe('KPIs', () => {
  test('never carry icons', async ({ page }) => {
    await mockApis(page);
    for (const route of ['/foundation', '/reports?tenantId=tenant-1', '/design-system']) {
      await page.goto(route);
      await expect(page.locator('.metric-card').first(), route).toBeVisible();
      await expect(page.locator('.metric-card :is(svg, img)'), route).toHaveCount(0);
    }
  });

  test('link to the detail behind the number', async ({ page }) => {
    await mockApis(page);
    await page.goto('/reports?tenantId=tenant-1');
    await page.getByRole('link', { name: /Cash collected/ }).click();
    await expect(page).toHaveURL(/#cash-report$/);
    await expect(
      page.getByRole('heading', { name: 'Evidence → collected → banked' }),
    ).toBeInViewport();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  });

  test('become one calm list on phones', async ({ page }) => {
    await mockApis(page);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/reports?tenantId=tenant-1');
    const grid = page.getByRole('region', { name: 'Management report headline metrics' });
    await expect(grid).toBeVisible();
    const columns = await grid.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
    );
    expect(columns).toBe(1);
  });
});

test.describe('click targets', () => {
  test('a whole attention item opens its work', async ({ page }) => {
    await page.goto('/foundation');
    await page.getByRole('link', { name: 'Open guided workflow' }).click();
    await expect(page).toHaveURL(/\/stations\/demo-station\/reconciliations\/new$/);
  });

  test('a whole table row opens its record', async ({ page }) => {
    await page.goto('/');
    const attention = page.getByRole('table', { name: 'Items that need attention' });
    await attention.getByRole('button', { name: /Review Cash short/ }).click();
    await expect(page.getByRole('dialog', { name: /Item review is in progress/ })).toBeVisible();
  });

  test('clickable things show the pointer cursor on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/foundation');

    const sidebar = page.locator('.shell-sidebar');
    expect(await cursorOver(page, sidebar.getByRole('link', { name: 'Reports' }))).toBe('pointer');
    expect(await cursorOver(page, sidebar.getByRole('button', { name: 'Operations' }))).toBe(
      'pointer',
    );
    expect(await cursorOver(page, sidebar.locator('.theme-option').first())).toBe('pointer');
    expect(await cursorOver(page, page.getByRole('button', { name: 'Open shift workflow' }))).toBe(
      'pointer',
    );

    // Plain information keeps the normal arrow.
    expect(await cursorOver(page, page.getByText('No authoritative action pending'))).toBe('auto');
  });
});

test.describe('data screens stay accessible', () => {
  const screens = [
    ['/reports?tenantId=tenant-1', 'Payments and products'],
    [
      '/inventory/valuation?tenantId=tenant-1&stationId=station-1',
      'Inventory needs a station context',
    ],
    ['/stations/station-1/cash?tenantId=tenant-1', 'Station collections'],
  ] as const;

  for (const width of [390, 1440]) {
    test(`no detectable violations at ${width}px`, async ({ page }) => {
      await mockApis(page);
      await page.setViewportSize({ width, height: 900 });
      for (const [route, heading] of screens) {
        await page.goto(route);
        await expect(page.getByRole('heading', { name: heading }).first(), route).toBeVisible();
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations, route).toEqual([]);
      }
    });
  }
});
