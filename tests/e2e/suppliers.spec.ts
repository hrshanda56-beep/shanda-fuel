import { expect, test, type Page } from '@playwright/test';

const context = {
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

const supplier = {
  supplierId: 'supplier-1',
  code: 'SUP-0001',
  legalName: 'Zimbabwe National Fuel Distribution Company',
  current: '120000.00',
  overdue: '65000.00',
  total: '185000.00',
};

async function mockSupplierApis(page: Page) {
  await page.route('**/api/context**', (route) => route.fulfill({ status: 200, json: context }));
  await page.route('**/api/suppliers/summary**', (route) =>
    route.fulfill({ status: 200, json: [supplier] }),
  );
  await page.route('**/api/suppliers/statement**', (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          sourceId: 'document-1',
          movementType: 'INVOICE',
          effectiveDate: '2026-09-20',
          postedAt: '2026-09-20T10:00:00Z',
          amount: '120000.00',
          runningBalance: '120000.00',
          currency: 'USD',
        },
      ],
    }),
  );
}

test.describe('supplier workflows', () => {
  test('creates a supplier through the existing command contract', async ({ page }) => {
    await mockSupplierApis(page);
    let commandBody: Record<string, unknown> | undefined;
    await page.route('**/api/suppliers/commands', async (route) => {
      commandBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        json: { supplierId: 'supplier-2', code: 'SUP-0002', legalName: 'Harare Fuel Hauliers' },
      });
    });

    await page.goto('/suppliers?tenantId=tenant-1&legalEntityId=entity-1');
    await expect(page.getByRole('link', { name: /SUP-0001/ })).toBeVisible();
    await page.getByRole('button', { name: 'Add supplier' }).first().click();
    await page.getByLabel('Supplier code').fill('SUP-0002');
    await page.getByLabel('Legal name').fill('Harare Fuel Hauliers');
    await page.getByRole('button', { name: 'Create supplier' }).click();

    await expect(
      page.getByRole('status').getByText('Supplier SUP-0002 was created.'),
    ).toBeVisible();
    expect(commandBody).toMatchObject({
      commandType: 'CreateSupplier',
      tenantId: 'tenant-1',
      legalEntityId: 'entity-1',
      code: 'SUP-0002',
      legalName: 'Harare Fuel Hauliers',
    });
  });

  test('loads the limited detail view from existing summary and statement reads', async ({
    page,
  }) => {
    await mockSupplierApis(page);
    await page.goto('/suppliers/supplier-1?tenantId=tenant-1&legalEntityId=entity-1');

    await expect(page.getByRole('heading', { name: supplier.legalName })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Statement' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'INVOICE' })).toBeVisible();
    const documentHeading = page.getByRole('heading', { name: 'Submit document' });
    const paymentHeading = page.getByRole('heading', { name: 'Submit payment' });
    await documentHeading.scrollIntoViewIfNeeded();
    await paymentHeading.scrollIntoViewIfNeeded();
    await expect(documentHeading).toBeVisible();
    await expect(paymentHeading).toBeVisible();
  });
});
