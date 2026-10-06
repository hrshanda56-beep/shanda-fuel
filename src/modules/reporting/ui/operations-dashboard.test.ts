import { describe, expect, it } from 'vitest';

import type { ManagementReport } from '../contracts';
import { selectOperationsDashboardMetrics } from './operations-dashboard';

const report = {
  sales: {
    salesValue: '123.4500',
    payments: [{ method: 'CUSTOMER_CREDIT', amount: '12.3400', evidenceIds: [] }],
  },
  cash: { cashEvidence: '100.0000', collected: '96.0000', cashVariance: '-4.0000' },
  inventory: { varianceLitres: '-2.500' },
} as unknown as ManagementReport;

describe('operations dashboard metric projection', () => {
  it('uses supported A10 facts and preserves unavailable source states', () => {
    expect(selectOperationsDashboardMetrics(report)).toEqual({
      sales: 'USD 123.4500',
      expectedCash: 'USD 100.0000',
      actualCash: 'USD 96.0000',
      cashVariance: 'USD -4.0000',
      fuelStockVariance: '-2.500',
      accountCreditSales: 'USD 12.3400',
      unresolvedExceptions: 'Unavailable',
      shiftCloseStatus: 'Unavailable',
    });
  });

  it('reports zero credit sales without inventing an account balance', () => {
    const noCredit = {
      ...report,
      sales: { ...report.sales, payments: [] },
    } as unknown as ManagementReport;

    expect(selectOperationsDashboardMetrics(noCredit).accountCreditSales).toBe('USD 0');
  });
});
