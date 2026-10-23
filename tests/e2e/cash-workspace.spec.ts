import AxeBuilder from '@axe-core/playwright';
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
    availableAtStation: '700.00',
    collectedButUnbanked: '800.00',
    pendingBankConfirmation: '100.00',
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

async function mockCash(
  page: import('@playwright/test').Page,
  current = context(),
  cashSummary: typeof summary = summary,
) {
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
      body: JSON.stringify(cashSummary),
    }),
  );
}

const actionBar = (page: import('@playwright/test').Page) => page.locator('.cash-action-bar');

test.describe('Cash workspace', () => {
  test('loads the selected station and keeps collection/deposit evidence distinct', async ({
    page,
  }) => {
    await mockCash(page);
    await page.goto('/stations/station-1/cash?tenantId=tenant-1');

    await expect(page.getByRole('heading', { name: 'Collections', exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Station cash collections' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bank deposits' })).toBeVisible();
    const collection = page.getByRole('row', { name: /COL-001/ });
    await expect(collection.locator('[data-label="Amount"]')).toHaveText('800.00 USD');
    await expect(collection.locator('[data-label="Still to bank"]')).toHaveText('800.00 USD');
    const deposit = page.getByRole('row', { name: /DEP-001/ });
    await expect(deposit).toContainText('100.00 USD');
    await expect(deposit).toContainText('On its way to the bank');

    // Forms live in a side sheet opened from the action bar.
    await actionBar(page).getByRole('button', { name: 'Receive cash' }).click();
    const sheet = page.getByRole('dialog', { name: 'Receive cash' });
    await expect(sheet.getByRole('button', { name: 'Receive cash', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await actionBar(page)
      .getByRole('button', { name: /^Confirm deposits/i })
      .click();
    await expect(
      page
        .getByRole('dialog', { name: 'Confirm bank deposits' })
        .getByRole('button', { name: 'Confirm deposit' }),
    ).toBeVisible();
  });

  test('the cash position legend is structurally valid once its figures load', async ({ page }) => {
    await mockCash(page);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/stations/station-1/cash?tenantId=tenant-1');
      const position = page.getByRole('region', { name: 'Cash Position' });
      // Three parts that never overlap, so they add up to everything collected.
      await expect(position).toContainText('At the station');
      await expect(position).toContainText('USD 700.00');
      await expect(position).toContainText('Waiting for the bank');
      await expect(position).toContainText('USD 100.00');
      await expect(position).toContainText('Banked');
      const results = await new AxeBuilder({ page }).include('.cash-panel').analyze();
      expect(results.violations, `width ${width}`).toEqual([]);
    }
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
    await actionBar(page).getByRole('button', { name: 'Receive cash' }).click();
    const receiveSheet = page.getByRole('dialog', { name: 'Receive cash' });
    await receiveSheet
      .getByRole('combobox', { name: 'Cash to receive' })
      .selectOption('collection-1');
    await receiveSheet
      .getByRole('combobox', { name: 'Receiving location' })
      .selectOption('location-2');
    await receiveSheet.getByRole('button', { name: 'Receive cash', exact: true }).click();

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
    await actionBar(page).getByRole('button', { name: 'Collect cash' }).click();
    const collectSheet = page.getByRole('dialog', { name: 'Collect cash' });
    await collectSheet
      .getByRole('combobox', { name: 'Shift cash' })
      .selectOption('reconciliation-1');
    await collectSheet
      .getByRole('combobox', { name: 'Where the cash is' })
      .selectOption('location-1');
    // Choosing a shift fills in the amount available; it can still be changed.
    await expect(collectSheet.getByLabel('Amount')).toHaveValue('1000.00');
    await collectSheet.getByLabel('Reference').fill('COL-002');
    await collectSheet.getByLabel('Amount').fill('25.00');
    await collectSheet.getByRole('button', { name: 'Collect cash', exact: true }).click();

    await expect(page.getByText('The cash collection is stale.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update and keep my details' })).toBeVisible();
  });

  test('a view-only role sees the cash position but no cash actions', async ({ page }) => {
    await mockCash(page, context(), {
      ...summary,
      capabilities: {
        viewDeposits: true,
        recordCollection: false,
        receiveCollection: false,
        recordDeposit: false,
        confirmDeposit: false,
      },
    });
    await page.goto('/stations/station-1/cash?tenantId=tenant-1');
    await expect(page.getByLabel('Cash position')).toBeVisible();
    for (const name of ['Collect cash', 'Receive cash', 'Bank cash', /Confirm deposits/]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    await expect(page.getByRole('heading', { name: 'No cash actions available' })).toBeVisible();
  });

  test('asks before discarding an unsaved sheet', async ({ page }) => {
    await mockCash(page);
    await page.goto('/stations/station-1/cash?tenantId=tenant-1');
    await actionBar(page).getByRole('button', { name: 'Collect cash' }).click();
    const sheet = page.getByRole('dialog', { name: 'Collect cash' });
    await sheet.getByLabel('Reference').fill('COL-003');
    await page.keyboard.press('Escape');
    await expect(sheet.getByText('Discard what you have entered?')).toBeVisible();
    await sheet.getByRole('button', { name: 'Keep editing' }).click();
    await expect(sheet.getByLabel('Reference')).toHaveValue('COL-003');
    await page.keyboard.press('Escape');
    await sheet.getByRole('button', { name: 'Discard' }).click();
    await expect(sheet).toBeHidden();
  });

  test('says what to do next and opens the bank sheet from a collection row', async ({ page }) => {
    await mockCash(page, context(), {
      ...summary,
      capabilities: { ...summary.capabilities, confirmDeposit: false },
    });
    await page.goto('/stations/station-1/cash?tenantId=tenant-1');
    await expect(page.getByRole('status')).toContainText('USD 700.00 is at the station');

    // The row's own button opens the sheet with the cash and its full amount already filled in.
    await page
      .getByRole('row', { name: /COL-001/ })
      .getByRole('button', { name: 'Bank it' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Bank cash' });
    await expect(sheet.getByRole('combobox', { name: /^Cash\b/ })).toHaveValue('collection-1');
    await expect(sheet.getByLabel('Amount')).toHaveValue('700.00');
  });

  test('opens a single deposit to confirm from its row', async ({ page }) => {
    await mockCash(page);
    await page.goto('/stations/station-1/cash?tenantId=tenant-1');
    await expect(page.getByRole('status')).toContainText('1 bank deposit is waiting');
    await page
      .getByRole('row', { name: /DEP-001/ })
      .getByRole('button', { name: 'Confirm' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Confirm bank deposits' });
    await expect(sheet.getByLabel('Amount the bank shows')).toHaveValue('100.00');
  });

  test('opens a row downwards to show every detail', async ({ page }) => {
    await mockCash(page);
    await page.goto('/stations/station-1/cash?tenantId=tenant-1');
    const row = page.getByRole('row', { name: /COL-001/ });
    await row.click();
    await expect(page.getByText('Collected from')).toBeVisible();
    await expect(page.getByText('Counted in shift report')).toBeVisible();
    await row.click();
    await expect(page.getByText('Collected from')).toBeHidden();
  });

  test('explains an empty sheet instead of showing a blank, disabled form', async ({ page }) => {
    await mockCash(page, context(), { ...summary, reconciliationSources: [] });
    await page.goto('/stations/station-1/cash?tenantId=tenant-1');
    await actionBar(page).getByRole('button', { name: 'Collect cash' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Collect cash' }).getByText(/no approved shift cash/i),
    ).toBeVisible();
  });
});
