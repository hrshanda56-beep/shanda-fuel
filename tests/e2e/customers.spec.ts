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
          legalEntities: [{ id: 'entity-1', name: 'TEI Oils', stations: [] }],
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
  contactMetadata: { contact: 'finance@acme.example' },
  accounts: [
    {
      accountId: 'account-1',
      accountType: 'CREDIT',
      status: 'ACTIVE',
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

async function mockCustomerApis(page: Page) {
  await page.route('**/api/context**', (route) => route.fulfill({ status: 200, json: context }));
  await page.route('**/api/customers/summary**', (route) =>
    route.fulfill({ status: 200, json: { customers: [customer] } }),
  );
}

test.describe('customer accounts Phase 0', () => {
  test('lists, searches and opens existing customer account data', async ({ page }) => {
    await mockCustomerApis(page);
    await page.goto('/customers?tenantId=tenant-1&legalEntityId=entity-1');

    await expect(page.getByRole('heading', { name: 'Customers', level: 2 })).toBeVisible();
    await expect(
      page.locator('.shell-sidebar').getByRole('link', { name: 'Customers', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Acme Transport/ })).toBeVisible();
    await expect(page.getByText('$250.00 owed')).toBeVisible();

    await page.getByLabel('Search customers').fill('does not exist');
    await expect(page.getByRole('heading', { name: 'No matching customers' })).toBeVisible();
    await page.getByLabel('Search customers').fill('Acme');
    await page.getByRole('link', { name: /Acme Transport/ }).click();

    await expect(page.getByRole('heading', { name: 'Acme Transport' })).toBeVisible();
    await expect(page.getByText('Available credit')).toBeVisible();
    await expect(page.getByText('Product balances')).toBeVisible();
    await expect(page.getByText('Fuel charged')).toBeVisible();
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
});
