import { describe, expect, it } from 'vitest';
import { buildConsolidatedReconciliationReadModel } from './consolidated-reconciliation';
import type { DailyOperationsRow } from './contracts';

function row(overrides: Partial<DailyOperationsRow> = {}): DailyOperationsRow {
  return {
    reportDate: '2026-09-20',
    stationId: '00000000-0000-4000-8000-000000000001',
    stationCode: 'MAIN',
    litresSold: '10.0000',
    salesValue: '100.0000',
    paymentBreakdown: [{ method: 'CASH', amount: '100.0000', evidenceIds: ['cash-1'] }],
    cashDeclared: '100.0000',
    cashVariance: '-1.2500',
    collectedCash: '99.0000',
    bankedCash: '50.0000',
    providerEvidence: '20.0000',
    providerSettledAmount: '18.0000',
    providerOutstandingAmount: '2.0000',
    recordedExpenses: '3.0000',
    inventoryVariance: '-2.0000',
    deliveryLitres: '500.0000',
    customerCreditEvidence: '10.0000',
    prepaidEvidence: '5.0000',
    reconciliationIds: ['reconciliation-1'],
    collectionIds: ['collection-1'],
    depositIds: ['deposit-1'],
    settlementIds: ['settlement-1'],
    deliveryIds: ['delivery-1'],
    ...overrides,
  };
}

describe('buildConsolidatedReconciliationReadModel', () => {
  it('sums each authorized station row exactly once', () => {
    const result = buildConsolidatedReconciliationReadModel([
      row(),
      row({
        reportDate: '2026-09-21',
        stationId: '00000000-0000-4000-8000-000000000002',
        stationCode: 'NORTH',
        litresSold: '2.5000',
        salesValue: '25.0000',
        paymentBreakdown: [
          { method: 'CASH', amount: '5.0000', evidenceIds: ['cash-2'] },
          { method: 'POS', amount: '20.0000', evidenceIds: ['pos-1'] },
        ],
        cashDeclared: '5.0000',
        cashVariance: '0.0000',
        collectedCash: '5.0000',
        bankedCash: '5.0000',
        providerEvidence: '20.0000',
        providerSettledAmount: '20.0000',
        providerOutstandingAmount: '0.0000',
        recordedExpenses: '1.0000',
        inventoryVariance: '-1.5000',
        deliveryLitres: '100.0000',
        customerCreditEvidence: '0.0000',
        prepaidEvidence: '0.0000',
        reconciliationIds: ['reconciliation-2'],
        collectionIds: ['collection-2'],
        depositIds: ['deposit-2'],
        settlementIds: ['settlement-2'],
        deliveryIds: ['delivery-2'],
      }),
    ]);

    expect(result).toMatchObject({
      report: 'CONSOLIDATED_RECONCILIATION',
      scope: 'ALL_AUTHORIZED_STATIONS',
      stationCount: 2,
      rowCount: 2,
      totals: {
        litresSold: '12.500',
        salesValue: '125.0000',
        cashDeclared: '105.0000',
        cashVariance: '-1.2500',
        providerEvidence: '40.0000',
        recordedExpenses: '4.0000',
        inventoryVariance: '-3.500',
      },
    });
    expect(result.totals.paymentBreakdown).toEqual([
      { method: 'CASH', amount: '105.0000', evidenceIds: ['cash-1', 'cash-2'] },
      { method: 'POS', amount: '20.0000', evidenceIds: ['pos-1'] },
    ]);
    expect(result.stationRows.map((station) => station.stationCode)).toEqual(['MAIN', 'NORTH']);
  });

  it('does not invent an inventory total when one station has unavailable variance', () => {
    const result = buildConsolidatedReconciliationReadModel([
      row(),
      row({
        stationId: '00000000-0000-4000-8000-000000000002',
        stationCode: 'NORTH',
        inventoryVariance: null,
      }),
    ]);

    expect(result.totals.inventoryVariance).toBeNull();
  });
});
