import type { Page } from '@playwright/test';

/**
 * SYNTHETIC GET /api/forecourt/reconciliations/:id responses, shaped like
 * ReconciliationDetail in reconciliation-statement.ts. Ids match the overview
 * fixture in data-filled.ts. `rec-review` answers 500 and `rec-draft` has no
 * cash count, so the statement's missing-figure handling can be exercised.
 */
const detail = (input: {
  expected: string;
  accounted: string;
  variance: string;
  litres: string;
  payments: Array<[string, string]>;
  expenses?: Array<[string, string, string]>;
  cash: { countedCash: string; netExpectedCash: string; cashVariance: string } | null;
}) => ({
  state: 'APPROVED',
  readings: [
    { id: 'r1', litresSold: input.litres, salesValue: input.expected },
    { id: 'r2', litresSold: '0.000', salesValue: '0.0000' },
  ],
  payments: input.payments.map(([method, amount], index) => ({
    id: `p${index}`,
    method,
    amount,
  })),
  expenses: (input.expenses ?? []).map(([category, amount, paymentMethod], index) => ({
    id: `e${index}`,
    category,
    amount,
    paymentMethod,
  })),
  cash: input.cash,
  totals: {
    expectedSales: input.expected,
    accountedSales: input.accounted,
    salesVariance: input.variance,
    cashVariance: input.cash?.cashVariance ?? null,
  },
});

const BODIES: Record<string, unknown> = {
  'rec-approved': detail({
    expected: '1250.0000',
    accounted: '1250.0000',
    variance: '0.0000',
    litres: '980.500',
    payments: [
      ['CASH', '800.0000'],
      ['ECOCASH', '300.0000'],
      ['POS', '150.0000'],
    ],
    expenses: [['FORECOURT_SUPPLIES', '20.0000', 'CASH']],
    cash: { countedCash: '780.0000', netExpectedCash: '780.0000', cashVariance: '0.0000' },
  }),
  'rec-returned': detail({
    expected: '640.5000',
    accounted: '600.0000',
    variance: '-40.5000',
    litres: '500.250',
    payments: [['CASH', '600.0000']],
    cash: { countedCash: '590.0000', netExpectedCash: '600.0000', cashVariance: '-10.0000' },
  }),
  'rec-draft': detail({
    expected: '300.0000',
    accounted: '300.0000',
    variance: '0.0000',
    litres: '240.000',
    payments: [['POS', '300.0000']],
    cash: null,
  }),
};

export async function mockReconciliationDetails(page: Page, options: { failIds?: string[] } = {}) {
  const failIds = options.failIds ?? ['rec-review'];
  await page.route('**/api/forecourt/reconciliations/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    const body = BODIES[id];
    if (failIds.includes(id) || !body) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}
