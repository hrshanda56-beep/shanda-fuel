import { expect, test } from '@playwright/test';

const context = (allStations = false) => ({
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
                  code: 'HRE-01',
                  name: 'Harare Road Service Station',
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
      ...(allStations ? {} : { stationId: 'station-1' }),
      allStations,
    },
    route: {
      pathname: '/stations/station-1/cash',
      policy: { legalEntity: 'required', station: 'required', allStationsAllowed: false },
    },
    persistedContextInvalid: false,
  },
});

const summary = {
  stationId: 'station-1',
  currency: 'USD',
  totals: {
    availableAtStation: '100.00',
    collectedButUnbanked: '700.00',
    pendingBankConfirmation: '700.00',
  },
  collections: [
    {
      collectionId: 'collection-1',
      collectionReference: 'COL-001',
      amount: '800.00',
      allocatedAmount: '100.00',
      confirmedAmount: '0',
      availableAtStation: '700.00',
      collectedButUnbanked: '800.00',
      pendingBankConfirmation: '100.00',
      state: 'RECORDED',
      custodyState: 'PARTIALLY_DEPOSITED',
      sourceLocationId: 'location-1',
      currentLocationId: 'location-1',
      version: 4,
    },
  ],
  locations: [
    { locationId: 'location-1', code: 'TILL', name: 'Station till', locationType: 'STATION_TILL' },
    { locationId: 'location-2', code: 'SAFE', name: 'Station safe', locationType: 'STATION_SAFE' },
  ],
  reconciliationSources: [
    {
      reconciliationId: 'reconciliation-1',
      businessDate: '2026-09-23',
      countedCash: '1000.00',
      allocatedCash: '0',
      availableCash: '1000.00',
    },
  ],
  bankAccounts: [
    {
      bankAccountId: 'bank-account-1',
      name: 'Operating account',
      bankName: 'Test Bank',
      accountReferenceMasked: '****0101',
    },
  ],
  deposits: [
    {
      depositId: 'deposit-1',
      depositReference: 'DEP-001',
      amount: '100.00',
      state: 'RECORDED',
      version: 2,
      sourceLocationId: 'location-1',
      bankAccountId: 'bank-account-1',
      bankAccountName: 'Operating account',
      confirmedAmount: null,
      confirmationVariance: null,
      bankReference: null,
    },
  ],
  capabilities: {
    viewDeposits: true,
    recordCollection: true,
    receiveCollection: true,
    recordDeposit: true,
    confirmDeposit: true,
  },
};

async function mockCash(page: import('@playwright/test').Page, current = context()) {
  await page.route('**/api/context**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(current),
    }),
  );
  await page.route('**/api/cash/summary**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(summary),
    }),
  );
}

test.describe('Cash workspace', () => {
  test('loads the selected station and keeps collection/deposit evidence distinct', async ({
    page,
  }) => {
    await mockCash(page);
    await page.goto('/stations/station-1/cash?tenantId=tenant-1');

    await expect(page.getByRole('heading', { name: 'Collected is not banked' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Station cash collections' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Deposits remain distinct from confirmation' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Receive collection' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm deposit' })).toBeVisible();
  });

  test('fits the Cash workspace at 320px and 390px without page overflow', async ({ page }) => {
    await mockCash(page);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/stations/station-1/cash?tenantId=tenant-1');
      await expect(page.getByRole('table', { name: 'Station cash collections' })).toBeVisible();
      const fits = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(fits, `Cash page should fit ${width}px`).toBe(true);
    }
  });

  test('renders an intentional context state and does not request a cash summary for all stations', async ({
    page,
  }) => {
    let summaryRequested = false;
    await mockCash(page, context(true));
    await page.unroute('**/api/cash/summary**');
    await page.route('**/api/cash/summary**', () => {
      summaryRequested = true;
    });
    await page.goto('/stations/station-1/cash?tenantId=tenant-1&allStations=true');

    await expect(
      page.getByRole('heading', { name: 'Select a station to load cash' }),
    ).toBeVisible();
    expect(summaryRequested).toBe(false);
  });

  test('posts a receive command with server-projected version and idempotency', async ({
    page,
  }) => {
    await mockCash(page);
    let commandPayload: Record<string, unknown> | undefined;
    let idempotencyKey = '';
    await page.route('**/api/cash/commands', async (route) => {
      commandPayload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      idempotencyKey = route.request().headers()['idempotency-key'] ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ state: 'RECEIVED' }),
      });
    });
    await page.goto('/stations/station-1/cash?tenantId=tenant-1');
    await page.getByRole('combobox', { name: 'Recorded collection' }).selectOption('collection-1');
    await page
      .getByRole('combobox', { name: 'Receiving cash location' })
      .selectOption('location-2');
    await page.getByRole('button', { name: 'Receive collection' }).click();

    await expect
      .poll(() => commandPayload)
      .toMatchObject({
        commandType: 'ReceiveCashCollection',
        context: {
          organisationId: 'tenant-1',
          legalEntityId: 'entity-1',
          stationId: 'station-1',
          allStations: false,
        },
        collectionId: 'collection-1',
        targetLocationId: 'location-2',
        expectedVersion: 4,
      });
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('shows a structured conflict after server validation rejects a stale command', async ({
    page,
  }) => {
    await mockCash(page);
    await page.route('**/api/cash/commands', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'The cash collection is stale' }),
      }),
    );
    await page.goto('/stations/station-1/cash?tenantId=tenant-1');
    await page
      .getByRole('combobox', { name: 'Approved reconciliation cash evidence' })
      .selectOption('reconciliation-1');
    await page.getByRole('combobox', { name: 'Source cash location' }).selectOption('location-1');
    await page.getByLabel('Collection reference').fill('COL-002');
    await page.getByLabel('Collected amount').fill('25.00');
    await page.getByRole('button', { name: 'Record collection' }).click();

    await expect(
      page.getByText(/The cash collection is stale.*Refresh the station position/),
    ).toBeVisible();
  });
});
