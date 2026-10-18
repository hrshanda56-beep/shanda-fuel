import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const organisationId = 'tenant-1';
const legalEntityId = 'entity-1';
const stationId = 'station-1';

type ContextFixture = {
  organisationId: string;
  legalEntityId: string;
  stationId?: string;
  allStations: boolean;
};

const settlementReference = 'ZSW-2026-09-20-000123456789';
const paymentReference = 'POS-2026-09-20-0001';

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

function contextBody(
  current: {
    organisationId: string;
    legalEntityId: string;
    stationId?: string;
    allStations: boolean;
  } | null,
) {
  return {
    data: {
      available: {
        organisations: [
          {
            id: organisationId,
            name: 'Test organisation',
            legalEntities: [
              {
                id: legalEntityId,
                name: 'Test legal entity',
                stations: [
                  {
                    id: stationId,
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
      current,
      route: {
        pathname: `/stations/${stationId}/settlements`,
        policy: { legalEntity: 'required', station: 'required', allStationsAllowed: false },
      },
      persistedContextInvalid: false,
    },
  };
}

function settlementRow(input: {
  state: 'RECORDED' | 'PARTIALLY_MATCHED' | 'RECONCILED' | 'EXCEPTION';
  allocatedAmount: string;
  unallocatedProviderAmount: string;
  varianceAmount: string;
  version: number;
}) {
  return {
    settlementId: 'settlement-1',
    providerId: 'provider-1',
    providerCode: 'ZSWITCH',
    providerName: 'Zimswitch POS acquiring services',
    providerAccountId: 'account-1',
    accountReference: 'MERCHANT-001',
    stationId,
    settlementReference,
    batchReference: 'BATCH-001',
    transactionDate: '2026-09-20',
    settlementDate: '2026-09-22',
    currency: 'USD',
    grossAmount: '100.0000',
    allocatedAmount: input.allocatedAmount,
    unallocatedProviderAmount: input.unallocatedProviderAmount,
    expectedEvidenceAmount: input.allocatedAmount,
    unmatchedEvidenceAmount: '0.0000',
    providerFeeAmount: '1.2500',
    providerDeductionAmount: '0.1250',
    reportedNetAmount: '98.6250',
    varianceAmount: input.varianceAmount,
    state: input.state,
    version: input.version,
  };
}

const unmatchedRow = {
  paymentId: 'payment-1',
  stationId,
  reconciliationId: 'reconciliation-1',
  reconciliationState: 'APPROVED',
  businessDate: '2026-09-20',
  method: 'POS',
  amount: '40.0000',
  reference: paymentReference,
  allocatedAmount: '0.0000',
  unallocatedAmount: '40.0000',
};

async function mockContext(
  page: Page,
  current: ContextFixture = { organisationId, legalEntityId, stationId, allStations: false },
) {
  await page.route('**/api/context*', (route) => route.fulfill(json(contextBody(current))));
}

async function waitForHydration(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
}

test.describe('provider settlement workspace', () => {
  test('does not fetch settlement data without an authorised station context', async ({ page }) => {
    let summaryRequests = 0;
    let unmatchedRequests = 0;
    await page.route('**/api/context*', (route) => route.fulfill(json(contextBody(null))));
    await page.route('**/api/settlements/summary**', (route) => {
      summaryRequests += 1;
      return route.fulfill(json([]));
    });
    await page.route('**/api/settlements/unmatched**', (route) => {
      unmatchedRequests += 1;
      return route.fulfill(json([]));
    });

    await page.goto(`/stations/${stationId}/settlements?tenantId=${organisationId}`);
    await waitForHydration(page);
    await expect(page.getByRole('heading', { name: 'Choose a station' })).toBeVisible();
    expect(summaryRequests).toBe(0);
    expect(unmatchedRequests).toBe(0);
  });

  test('loads authorised station evidence, allocates, reconciles and refreshes from the server', async ({
    page,
  }) => {
    let state: 'PARTIALLY_MATCHED' | 'RECONCILED' = 'PARTIALLY_MATCHED';
    let allocatedAmount = '60.0000';
    let unallocatedAmount = '40.0000';
    let varianceAmount = '40.0000';
    let version = 1;
    const commands: Array<{ body: Record<string, unknown>; idempotencyKey: string }> = [];

    await mockContext(page);
    await page.route('**/api/settlements/summary**', (route) =>
      route.fulfill(
        json([
          settlementRow({
            state,
            allocatedAmount,
            unallocatedProviderAmount: unallocatedAmount,
            varianceAmount,
            version,
          }),
        ]),
      ),
    );
    await page.route('**/api/settlements/unmatched**', (route) =>
      route.fulfill(json(state === 'RECONCILED' ? [] : [unmatchedRow])),
    );
    await page.route('**/api/settlements/commands', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      commands.push({ body, idempotencyKey: route.request().headers()['idempotency-key'] ?? '' });
      if (body.commandType === 'AllocateProviderSettlement') {
        state = 'PARTIALLY_MATCHED';
        allocatedAmount = '100.0000';
        unallocatedAmount = '0.0000';
        varianceAmount = '0.0000';
        version = 2;
        await route.fulfill(json({ allocationId: 'allocation-1' }, 201));
        return;
      }
      state = 'RECONCILED';
      version = 3;
      await route.fulfill(json({ settlementId: 'settlement-1', state }, 200));
    });

    await page.goto(`/stations/${stationId}/settlements?tenantId=${organisationId}`);
    await waitForHydration(page);
    await expect(
      page.getByRole('list', { name: 'Provider payouts' }).getByText(settlementReference),
    ).toBeVisible();
    await expect(page.getByText(paymentReference)).toBeVisible();

    await page.getByRole('button', { name: 'Match', exact: true }).click();
    const matchDialog = page.getByRole('dialog', { name: 'Match a payment' });
    await expect(matchDialog).toBeVisible();
    await matchDialog.getByLabel('Provider payout').selectOption('settlement-1');
    await matchDialog.getByLabel('Customer payment').selectOption('payment-1');
    await matchDialog.getByLabel('Amount to match').fill('40.0000');
    await matchDialog.getByRole('button', { name: 'Match', exact: true }).click();
    await expect(
      page.locator('p[role="status"]').filter({ hasText: 'Allocation saved' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Reconciled', { exact: true })).toBeVisible();
    expect(commands.map(({ body }) => body.commandType)).toEqual([
      'AllocateProviderSettlement',
      'ReconcileProviderSettlement',
    ]);
    expect(commands[0]?.body.stationId).toBe(stationId);
    expect(commands[1]?.body.stationId).toBe(stationId);

    const results = await new AxeBuilder({ page }).include('#main-content').analyze();
    expect(results.violations).toEqual([]);
  });

  test('requires an explicit variance reason before reconciliation', async ({ page }) => {
    let reconciled = false;
    let commandBody: Record<string, unknown> | null = null;
    await mockContext(page);
    await page.route('**/api/settlements/summary**', (route) =>
      route.fulfill(
        json([
          settlementRow({
            state: reconciled ? 'EXCEPTION' : 'PARTIALLY_MATCHED',
            allocatedAmount: '60.0000',
            unallocatedProviderAmount: '40.0000',
            varianceAmount: '40.0000',
            version: reconciled ? 2 : 1,
          }),
        ]),
      ),
    );
    await page.route('**/api/settlements/unmatched**', (route) =>
      route.fulfill(json([unmatchedRow])),
    );
    await page.route('**/api/settlements/commands', async (route) => {
      commandBody = route.request().postDataJSON() as Record<string, unknown>;
      reconciled = true;
      await route.fulfill(json({ settlementId: 'settlement-1', state: 'EXCEPTION' }));
    });

    await page.goto(`/stations/${stationId}/settlements?tenantId=${organisationId}`);
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByLabel('Variance reason')).toBeVisible();
    await page
      .getByLabel('Variance reason')
      .fill('Provider statement differs from approved POS evidence.');
    await page.getByRole('button', { name: 'Confirm reconciliation' }).click();
    await expect(page.getByText('Exception', { exact: true })).toBeVisible();
    expect(commandBody).toBeTruthy();
    expect((commandBody as unknown as { reason?: unknown } | null)?.reason).toBe(
      'Provider statement differs from approved POS evidence.',
    );
  });

  test('rejects all-stations context before any settlement read or command', async ({ page }) => {
    let settlementRequests = 0;
    await mockContext(page, { organisationId, legalEntityId, allStations: true });
    await page.route('**/api/settlements/summary**', (route) => {
      settlementRequests += 1;
      return route.fulfill(json([]));
    });
    await page.route('**/api/settlements/unmatched**', (route) => {
      settlementRequests += 1;
      return route.fulfill(json([]));
    });

    await page.goto(
      `/stations/${stationId}/settlements?tenantId=${organisationId}&allStations=true`,
    );
    await waitForHydration(page);
    await expect(page.getByRole('heading', { name: 'Choose a station' })).toBeVisible();
    expect(settlementRequests).toBe(0);
  });

  test('reuses the same idempotency key when an allocation retry follows a conflict', async ({
    page,
  }) => {
    let conflict = true;
    const idempotencyKeys: string[] = [];
    await mockContext(page);
    await page.route('**/api/settlements/summary**', (route) =>
      route.fulfill(
        json([
          settlementRow({
            state: 'PARTIALLY_MATCHED',
            allocatedAmount: '60.0000',
            unallocatedProviderAmount: '40.0000',
            varianceAmount: '40.0000',
            version: 1,
          }),
        ]),
      ),
    );
    await page.route('**/api/settlements/unmatched**', (route) =>
      route.fulfill(json([unmatchedRow])),
    );
    await page.route('**/api/settlements/commands', async (route) => {
      idempotencyKeys.push(route.request().headers()['idempotency-key'] ?? '');
      if (conflict) {
        conflict = false;
        await route.fulfill(
          json({ error: 'CONFLICT', message: 'The provider settlement is stale' }, 409),
        );
        return;
      }
      await route.fulfill(json({ allocationId: 'allocation-1' }, 201));
    });

    await page.goto(`/stations/${stationId}/settlements?tenantId=${organisationId}`);
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Match', exact: true }).click();
    const matchDialog = page.getByRole('dialog', { name: 'Match a payment' });
    await matchDialog.getByLabel('Provider payout').selectOption('settlement-1');
    await matchDialog.getByLabel('Customer payment').selectOption('payment-1');
    await matchDialog.getByLabel('Amount to match').fill('40.0000');
    await matchDialog.getByRole('button', { name: 'Match', exact: true }).click();
    await expect(page.getByText('The provider settlement is stale')).toBeVisible();
    await page.getByRole('button', { name: 'Match', exact: true }).click();
    await expect(
      page.locator('p[role="status"]').filter({ hasText: 'Allocation saved' }),
    ).toBeVisible();
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
  });
});
