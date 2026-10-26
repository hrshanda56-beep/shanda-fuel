import { describe, expect, it } from 'vitest';
import type { ManagementReport } from './contracts';
import { buildFinanceTiles } from './finance-tiles';

const report = (over: Record<string, unknown> = {}) =>
  ({
    grossMargin: '100.0000',
    revenue: { sales: [] },
    costing: { sales: [] },
    expenses: {
      operatingTotal: '10.0000',
      fixedCostTotal: '20.0000',
      rows: [
        { businessDate: '2026-10-01', classification: 'OPERATING', amount: '10.0000' },
        { businessDate: '2026-10-01', classification: 'FIXED_COST', amount: '20.0000' },
      ],
    },
    sales: { payments: [{ method: 'STAFF_OR_MANAGEMENT_FUEL', amount: '5.0000' }] },
    cash: { collectedButNotBanked: '1.0000', banked: '2.0000' },
    providers: { unmatchedEvidenceAmount: '3.0000' },
    suppliers: { outstandingBalance: '4.0000' },
    customers: { availability: 'AVAILABLE', receivableBalance: '5.0000' },
    ownerPosition: {
      stockValue: '6.0000',
      unvaluedStockStreams: 0,
      unpaidExpenses: '0.0000',
      expensesAwaitingApproval: { count: 3, amount: '7.0000' },
    },
    ...over,
  }) as unknown as ManagementReport;

const byId = (tiles: ReturnType<typeof buildFinanceTiles>, id: string) =>
  tiles.find((t) => t.id === id)!;

describe('buildFinanceTiles', () => {
  it('returns all nine tiles from report figures', () => {
    const tiles = buildFinanceTiles(report());
    expect(tiles.map((t) => t.id)).toHaveLength(9);
    expect(byId(tiles, 'grossProfit').value).toBe('100.0000');
    // 100 gross - 10 operating - 20 fixed - 5 approved fuel
    expect(byId(tiles, 'operatingProfit').value).toBe('65');
    expect(byId(tiles, 'stockValue').value).toBe('6.0000');
    expect(byId(tiles, 'expensesAwaitingApproval')).toMatchObject({ value: '7.0000', count: 3 });
  });

  it('never shows zero for figures that are not known', () => {
    const tiles = buildFinanceTiles(
      report({
        grossMargin: null,
        ownerPosition: undefined,
        customers: { availability: 'UNAVAILABLE_STATION_DIMENSION', receivableBalance: null },
      }),
    );
    for (const id of ['grossProfit', 'stockValue', 'debtors', 'expensesAwaitingApproval'])
      expect(byId(tiles, id).value).toBeNull();
    expect(byId(tiles, 'debtors').unavailableReason).toContain('all stations');
  });

  it('says there are no sales, not that costs are missing, when nothing was sold', () => {
    const tiles = buildFinanceTiles(
      report({ grossMargin: null, sales: { salesValue: '0.0000', payments: [] } }),
    );
    expect(byId(tiles, 'grossProfit').unavailableReason).toBe('No sales yet.');
    expect(byId(tiles, 'operatingProfit').unavailableReason).toBe('No sales yet.');
  });

  it('still reports missing fuel cost when there are sales', () => {
    const tiles = buildFinanceTiles(
      report({ grossMargin: null, sales: { salesValue: '50.0000', payments: [] } }),
    );
    expect(byId(tiles, 'grossProfit').unavailableReason).toBe('Some sales have no fuel cost yet.');
  });
});
