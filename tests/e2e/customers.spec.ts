import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const tenantId = 'tenant-1';
const context = {
  data: {
    available: {
      organisations: [
        {
          id: tenantId,
          name: 'ShandaHR',
          legalEntities: [
            {
              id: 'entity-1',
              name: 'TEI Oils',
              stations: [
                { id: 'station-1', code: 'SND', name: 'Sandawana', timezone: 'Africa/Harare' },
                { id: 'station-2', code: 'HRE', name: 'Harare', timezone: 'Africa/Harare' },
              ],
            },
          ],
        },
      ],
    },
    current: {
      organisationId: tenantId,
      legalEntityId: 'entity-1',
      allStations: false,
    },
    route: {
      pathname: '/customers',
      policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: false },
    },
    persistedContextInvalid: false,
  },
};

const customer = {
  customerId: 'customer-1',
  accountReference: 'ACME-001',
  displayName: 'Acme Transport',
  status: 'ACTIVE',
  version: 0,
  legalEntityId: null,
  legalEntityName: null,
  canManageConfiguration: true,
  contactMetadata: { contact: 'finance@acme.example' },
  accounts: [
    {
      accountId: 'account-1',
      accountType: 'CREDIT',
      status: 'ACTIVE',
      version: 0,
      legalEntityId: null,
      stationScope: 'ALL',
      stationScopeConfigured: false,
      allowedStationIds: [],
      ready: false,
      currency: 'USD',
      creditLimit: '1000.0000',
      balance: '250.0000',
      availableBalance: null,
      availableCredit: '750.0000',
      reservedAmount: '0.0000',
      productBalances: [],
    },
    {
      accountId: 'account-2',
      accountType: 'PREPAID_LITRES',
      status: 'ACTIVE',
      version: 0,
      legalEntityId: null,
      stationScope: 'ALL',
      stationScopeConfigured: false,
      allowedStationIds: [],
      ready: false,
      currency: 'USD',
      creditLimit: null,
      balance: null,
      availableBalance: null,
      availableCredit: null,
      reservedAmount: '0.0000',
      productBalances: [
        {
          productId: 'product-1',
          productCode: 'D50',
          productName: 'Diesel 50 ppm',
          balanceLitres: '120.000',
          availableLitres: '120.000',
        },
      ],
    },
  ],
  recentTransactions: [
    {
      id: 'entry-1',
      accountId: 'account-1',
      accountType: 'CREDIT',
      entryType: 'CREDIT_FUEL_CHARGE',
      direction: 'INCREASE',
      occurredAt: '2026-09-20T08:00:00Z',
      businessDate: '2026-09-20',
      amount: '250.0000',
      currency: 'USD',
      litres: null,
      productId: 'product-1',
      productCode: 'D50',
      productName: 'Diesel 50 ppm',
      note: null,
    },
  ],
};

const readyCustomer = {
  ...customer,
  version: 1,
  legalEntityId: 'entity-1',
  legalEntityName: 'TEI Oils',
  accounts: customer.accounts.map((account) => ({
    ...account,
    version: 1,
    legalEntityId: 'entity-1',
    stationScope: 'SELECTED' as const,
    stationScopeConfigured: true,
    allowedStationIds: ['station-1'],
    ready: true,
  })),
};

async function mockCustomerApis(page: Page) {
  await page.route('**/api/context**', (route) => route.fulfill({ status: 200, json: context }));
  await page.route('**/api/customers/summary**', (route) =>
    route.fulfill({ status: 200, json: { customers: [customer] } }),
  );
}

test.describe('customer accounts', () => {
  test('lists, searches and opens existing customer account data', async ({ page }) => {
    await mockCustomerApis(page);
    await page.goto('/customers?tenantId=tenant-1&legalEntityId=entity-1');

    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await expect(
      page.locator('.shell-sidebar').getByRole('link', { name: 'Customers', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Acme Transport/ })).toBeVisible();
    await expect(page.getByText('USD 250.00 outstanding')).toBeVisible();

    await page.getByLabel('Search customers').fill('does not exist');
    await expect(page.getByRole('heading', { name: 'No matching customers' })).toBeVisible();
    await page.getByLabel('Search customers').fill('Acme');
    await page.getByRole('link', { name: /Acme Transport/ }).click();

    await expect(page.getByRole('heading', { name: 'Acme Transport' })).toBeVisible();
    await expect(page.getByText('Available credit')).toBeVisible();
    await expect(page.getByText('Product balances')).toBeVisible();
    await expect(page.getByText('Fuel charged')).toBeVisible();
    await expect(page.getByText('Not shown here yet')).toBeVisible();
  });

  test('keeps the customer detail usable on a phone and accessible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCustomerApis(page);
    await page.goto('/customers/customer-1?tenantId=tenant-1&legalEntityId=entity-1');

    await expect(page.getByRole('heading', { name: 'Acme Transport' })).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('link', { name: 'Customers', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('lets an owner or administrator confirm legal entity and explicit station scope', async ({
    page,
  }) => {
    let scopeCommands = 0;
    let saved = false;
    const saveRequests: Array<Record<string, unknown>> = [];
    await page.route('**/api/context**', (route) => route.fulfill({ status: 200, json: context }));
    await page.route('**/api/customers/summary**', (route) =>
      route.fulfill({ status: 200, json: { customers: [saved ? readyCustomer : customer] } }),
    );
    await page.route('**/api/customers/commands', async (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      saveRequests.push(request);
      if (request.commandType === 'SetCustomerAccountStations') scopeCommands += 1;
      if (scopeCommands === 2) saved = true;
      await route.fulfill({ status: 200, json: { ok: true } });
    });

    await page.goto('/customers/customer-1?tenantId=tenant-1&legalEntityId=entity-1');
    await expect(page.getByText('Customer account is not ready')).toBeVisible();
    await page.getByLabel('Customer legal entity').selectOption('entity-1');
    await page.locator('select[id^="customer-station-scope-"]').nth(0).selectOption('SELECTED');
    await page
      .getByRole('checkbox', { name: /Sandawana/ })
      .nth(0)
      .check();
    await page.locator('select[id^="customer-station-scope-"]').nth(1).selectOption('ALL');
    await page.getByRole('button', { name: 'Save customer scope' }).click();

    await expect(page.getByText('Customer access scope saved and confirmed.')).toBeVisible();
    await expect(page.getByText('Ready').first()).toBeVisible();
    expect(saveRequests.map((request) => request.commandType)).toEqual([
      'SetCustomerLegalEntity',
      'SetCustomerAccountStations',
      'SetCustomerAccountStations',
    ]);
    expect(saveRequests[1]).toMatchObject({
      stationScope: 'SELECTED',
      stationIds: ['station-1'],
    });
    expect(saveRequests[2]).toMatchObject({ stationScope: 'ALL' });
  });

  test('keeps Finance read-only while historical customer reads remain available', async ({
    page,
  }) => {
    const financeCustomer = {
      ...readyCustomer,
      canManageConfiguration: false,
    };
    await page.route('**/api/context**', (route) => route.fulfill({ status: 200, json: context }));
    await page.route('**/api/customers/summary**', (route) =>
      route.fulfill({ status: 200, json: { customers: [financeCustomer] } }),
    );

    await page.goto('/customers/customer-1?tenantId=tenant-1&legalEntityId=entity-1');
    await expect(page.getByText('Configuration is restricted')).toBeVisible();
    await expect(
      page.getByText(/Finance access remains read-only, including historical account activity/),
    ).toBeVisible();
    await expect(page.getByText('Fuel charged')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save customer scope' })).toHaveCount(0);
  });
});
