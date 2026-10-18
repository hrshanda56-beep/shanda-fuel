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
  capabilities: { recordPayment: true, topUp: true, manageCustomer: true, openAccount: true },
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

    await expect(page.getByRole('heading', { name: 'Customer accounts' })).toBeVisible();
    await expect(
      page.locator('.shell-sidebar').getByRole('link', { name: 'Customers', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('Acme Transport')).toBeVisible();
    await expect(page.getByText('USD 250.00 outstanding')).toBeVisible();

    await page.getByLabel('Search customers').fill('does not exist');
    await expect(page.getByRole('heading', { name: 'No matching customers' })).toBeVisible();
    await page.getByLabel('Search customers').fill('Acme');
    await page.getByRole('button', { name: 'Show details for Acme Transport' }).click();
    await page.getByRole('link', { name: 'Open full account' }).click();

    await expect(page.getByRole('heading', { name: 'Acme Transport' })).toBeVisible();
    await expect(page.getByText('Can still buy on credit').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Prepaid fuel' })).toBeVisible();
    await expect(page.getByText('Fuel charged')).toBeVisible();
    await expect(page.getByText('Not shown here yet')).toHaveCount(0);
  });

  test('keeps the customer detail usable on a phone and accessible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCustomerApis(page);
    await page.goto('/customers/customer-1?tenantId=tenant-1&legalEntityId=entity-1');

    await expect(page.getByRole('heading', { name: 'Acme Transport' })).toBeVisible();
    await page.getByRole('button', { name: 'More' }).click();
    await expect(
      page
        .getByRole('dialog', { name: 'More' })
        .getByRole('link', { name: 'Customers', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
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
    await expect(page.getByText('This customer cannot buy fuel yet')).toBeVisible();
    await page.getByLabel('Company the customer buys from').selectOption('entity-1');
    await page.locator('select[id^="customer-station-scope-"]').nth(0).selectOption('SELECTED');
    await page
      .getByRole('checkbox', { name: /Sandawana/ })
      .nth(0)
      .check();
    await page.locator('select[id^="customer-station-scope-"]').nth(1).selectOption('ALL');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(
      page.getByText('Saved. This customer’s fuel-buying settings are up to date.'),
    ).toBeVisible();
    await expect(page.getByText('Ready', { exact: true }).first()).toBeVisible();
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
      capabilities: {
        recordPayment: false,
        topUp: false,
        manageCustomer: false,
        openAccount: false,
      },
    };
    await page.route('**/api/context**', (route) => route.fulfill({ status: 200, json: context }));
    await page.route('**/api/customers/summary**', (route) =>
      route.fulfill({ status: 200, json: { customers: [financeCustomer] } }),
    );

    await page.goto('/customers/customer-1?tenantId=tenant-1&legalEntityId=entity-1');
    await page.getByText('Where this customer can buy fuel').click();
    await expect(page.getByText('Only an owner or administrator can change this')).toBeVisible();
    await expect(page.getByText('Fuel charged')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    const actions = page.getByRole('group', { name: 'Customer actions' });
    await expect(actions.getByRole('button')).toHaveCount(0);
  });

  test('records a payment and suspends a customer from the account page', async ({ page }) => {
    const commands: Array<Record<string, unknown>> = [];
    await page.route('**/api/context**', (route) => route.fulfill({ status: 200, json: context }));
    await page.route('**/api/customers/summary**', (route) =>
      route.fulfill({ status: 200, json: { customers: [readyCustomer], fuelProducts: [] } }),
    );
    await page.route('**/api/customers/commands', async (route) => {
      commands.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 201, json: { ok: true } });
    });

    await page.goto('/customers/customer-1?tenantId=tenant-1&legalEntityId=entity-1');
    await page.getByRole('button', { name: 'Record a payment' }).click();
    await page.getByLabel(/Amount received/).fill('120.5');
    await page
      .getByLabel('Where was the money received?')
      .selectOption({ label: 'Sandawana (SND)' });
    await page.getByRole('button', { name: 'Record payment' }).click();

    await expect(
      page.getByText('Payment of USD 120.50 from Acme Transport recorded.'),
    ).toBeVisible();
    expect(commands[0]).toMatchObject({
      commandType: 'RecordCustomerPayment',
      accountId: 'account-1',
      receivingStationId: 'station-1',
      amount: { amount: '120.5', currency: 'USD' },
      source: { sourceType: 'CUSTOMER_PAYMENT' },
    });

    await page.getByRole('button', { name: 'Suspend customer' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('will not be able to buy fuel');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Suspend customer' }).click();
    await expect(page.getByText('Acme Transport is suspended.')).toBeVisible();
    expect(commands[1]).toMatchObject({
      commandType: 'DeactivateCustomer',
      customerId: 'customer-1',
      expectedVersion: 1,
    });
  });

  test('asks for a sensible payment amount before sending anything', async ({ page }) => {
    let sent = 0;
    await page.route('**/api/context**', (route) => route.fulfill({ status: 200, json: context }));
    await page.route('**/api/customers/summary**', (route) =>
      route.fulfill({ status: 200, json: { customers: [readyCustomer], fuelProducts: [] } }),
    );
    await page.route('**/api/customers/commands', (route) => {
      sent += 1;
      return route.fulfill({ status: 201, json: {} });
    });
    await page.goto('/customers/customer-1?tenantId=tenant-1&legalEntityId=entity-1');
    await page.getByRole('button', { name: 'Record a payment' }).click();
    await page.getByLabel(/Amount received/).fill('0');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByRole('alert')).toContainText('Enter the amount received');
    expect(sent).toBe(0);
  });
});
