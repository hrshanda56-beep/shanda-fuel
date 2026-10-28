import { describe, expect, it } from 'vitest';
import type { ManagementReport } from '../../reporting/contracts';
import { buildProfitView, formatPerLitre, moneyOrUnavailable } from './profit-model';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';

function revenueSale(stationId: string, amount: string, litres: string) {
  return { stationId, recognizedRevenue: amount, quantityLitres: litres };
}
function costSale(stationId: string, cogs: string | null) {
  return {
    stationId,
    restatedCogs: cogs,
    valuationStatus: cogs === null ? 'UNVALUED' : 'VALUED',
  };
}

function report(overrides: {
  revenue: unknown[];
  cost: unknown[];
  costingStatus: string;
  restated: string | null;
  unvalued?: number;
  expenses?: {
    stationId: string;
    amount: string;
    classification?: 'OPERATING' | 'FIXED_COST' | 'DIRECT_INVENTORY_COST';
  }[];
}): ManagementReport {
  const expenseRows = overrides.expenses ?? [];
  const total = expenseRows.reduce((t, r) => t + Number(r.amount), 0).toFixed(2);
  const operatingTotal = expenseRows
    .filter(
      (r) => r.classification !== 'DIRECT_INVENTORY_COST' && r.classification !== 'FIXED_COST',
    )
    .reduce((t, r) => t + Number(r.amount), 0)
    .toFixed(2);
  const fixedCostTotal = expenseRows
    .filter((r) => r.classification === 'FIXED_COST')
    .reduce((t, r) => t + Number(r.amount), 0)
    .toFixed(2);
  const directInventoryCostTotal = expenseRows
    .filter((r) => r.classification === 'DIRECT_INVENTORY_COST')
    .reduce((t, r) => t + Number(r.amount), 0)
    .toFixed(2);
  return {
    stations: [
      { stationId: S1, code: 'A', name: 'Avondale' },
      { stationId: S2, code: 'B', name: 'Borrowdale' },
    ],
    sales: {
      rows: [
        { productId: 'p1', productName: 'Diesel', litres: '100', salesValue: '150' },
        { productId: 'p1', productName: 'Diesel', litres: '100', salesValue: '150' },
      ],
    },
    expenses: {
      total,
      operatingTotal,
      fixedCostTotal,
      directInventoryCostTotal,
      rows: expenseRows,
    },
    revenue: {
      saleCount: overrides.revenue.length,
      recognizedRevenue: overrides.revenue
        .reduce(
          (t: number, s) => t + Number((s as { recognizedRevenue: string }).recognizedRevenue),
          0,
        )
        .toFixed(4),
      sales: overrides.revenue,
    },
    costing: {
      costingStatus: overrides.costingStatus,
      restatedCogs: overrides.restated,
      saleCount: overrides.cost.length,
      unvaluedSaleCount: overrides.unvalued ?? 0,
      sales: overrides.cost,
    },
  } as unknown as ManagementReport;
}

describe('buildProfitView', () => {
  it('works out profit when sales and costs are complete', () => {
    const view = buildProfitView(
      report({
        revenue: [revenueSale(S1, '300.0000', '200'), revenueSale(S2, '100.0000', '80')],
        cost: [costSale(S1, '200.0000'), costSale(S2, '60.0000')],
        costingStatus: 'COMPLETE',
        restated: '260.0000',
        expenses: [{ stationId: S1, amount: '20.00' }],
      }),
    );
    expect(view.state).toBe('ready');
    expect(view.grossProfit).toBe('140');
    expect(view.profit).toBe('120');
    expect(view.litres).toBe('280');
    expect(view.stations.map((s) => [s.name, s.profit])).toEqual([
      ['Avondale', '80'],
      ['Borrowdale', '40'],
    ]);
  });

  it('never turns a missing cost into zero', () => {
    const view = buildProfitView(
      report({
        revenue: [revenueSale(S1, '300.0000', '200'), revenueSale(S2, '100.0000', '80')],
        cost: [costSale(S1, '200.0000'), costSale(S2, null)],
        costingStatus: 'UNVALUED',
        restated: null,
        unvalued: 1,
      }),
    );
    expect(view.state).toBe('cost-missing');
    expect(view.fuelCost).toBeNull();
    expect(view.profit).toBeNull();
    expect(view.perLitre).toBeNull();
    expect(view.explanation).toContain('1 of 2 sales');
    const borrowdale = view.stations.find((s) => s.name === 'Borrowdale');
    expect(borrowdale?.profit).toBeNull();
    expect(view.stations.find((s) => s.name === 'Avondale')?.profit).toBe('100');
  });

  it('says so when there are no sales', () => {
    const view = buildProfitView(
      report({ revenue: [], cost: [], costingStatus: 'NO_SALES', restated: '0.0000' }),
    );
    expect(view.state).toBe('no-sales');
    expect(view.sales).toBeNull();
    expect(view.profit).toBeNull();
  });

  it('shows loss wording for a negative profit', () => {
    const view = buildProfitView(
      report({
        revenue: [revenueSale(S1, '100.0000', '50')],
        cost: [costSale(S1, '90.0000')],
        costingStatus: 'COMPLETE',
        restated: '90.0000',
        expenses: [{ stationId: S1, amount: '30.00' }],
      }),
    );
    expect(view.profit).toBe('-20');
    expect(view.headline).toMatch(/loss/);
  });

  it('does not subtract direct inventory cost a second time from profit', () => {
    const view = buildProfitView(
      report({
        revenue: [revenueSale(S1, '100.0000', '50')],
        cost: [costSale(S1, '60.0000')],
        costingStatus: 'COMPLETE',
        restated: '60.0000',
        expenses: [
          { stationId: S1, amount: '10.00', classification: 'OPERATING' },
          { stationId: S1, amount: '90.00', classification: 'DIRECT_INVENTORY_COST' },
        ],
      }),
    );
    expect(view.profit).toBe('30');
    expect(view.stations.find((station) => station.name === 'Avondale')?.profit).toBe('30');
  });

  it('groups sales by fuel without inventing a cost', () => {
    const view = buildProfitView(
      report({
        revenue: [revenueSale(S1, '300.0000', '200')],
        cost: [costSale(S1, '200.0000')],
        costingStatus: 'COMPLETE',
        restated: '200.0000',
      }),
    );
    expect(view.fuels).toHaveLength(1);
    expect(view.fuels[0]).toMatchObject({ name: 'Diesel', litres: '200', sales: '300' });
  });
});

describe('formatting', () => {
  it('shows Not available instead of zero', () => {
    expect(moneyOrUnavailable(null)).toBe('Not available');
    expect(moneyOrUnavailable('1245.5')).toBe('USD 1,245.50');
    expect(formatPerLitre(null)).toBe('Not available');
    expect(formatPerLitre('0.12345')).toBe('USD 0.123 per litre');
  });
});
