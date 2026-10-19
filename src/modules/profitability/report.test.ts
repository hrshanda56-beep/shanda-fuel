import { describe, expect, it } from 'vitest';
import { classifyGrossMargin, summarizeCanonicalRevenue, summarizeRestatedCogs } from './domain';
import { buildFuelProfitRows, buildProfitabilityReport } from './report';
import type { CanonicalSaleRevenue, RestatedSaleCogs } from './contracts';

const T = '00000000-0000-4000-8000-0000000000aa';
const S = '00000000-0000-4000-8000-0000000000bb';

function rev(amount: string, n = 1): CanonicalSaleRevenue {
  return {
    stationId: S,
    productId: T,
    productCode: 'PMS',
    productName: 'Petrol',
    reconciliationId: S,
    revisionId: S,
    meterSegmentId: `00000000-0000-4000-8000-00000000010${n}`,
    revenueMovementId: `00000000-0000-4000-8000-00000000020${n}`,
    recognizedRevenue: amount,
    quantityLitres: '1.000',
    businessDate: '2026-10-01',
    effectiveAt: '2026-10-01T07:00:00.000Z',
    currency: 'USD',
  };
}

function cogs(over: Partial<RestatedSaleCogs> = {}): RestatedSaleCogs {
  return {
    stationId: S,
    productId: T,
    productCode: 'PMS',
    productName: 'Petrol',
    reconciliationId: S,
    revisionId: S,
    meterSegmentId: S,
    saleMovementId: S,
    attributionId: S,
    originalSaleCogsEventId: S,
    originalCogs: '80.1234',
    revaluationDelta: '1.2500',
    revaluationLineIds: [],
    revaluationEventIds: [],
    restatedCogs: '81.3734',
    businessDate: '2026-10-01',
    effectiveAt: '2026-10-01T07:00:00.000Z',
    currency: 'USD',
    valuationStatus: 'VALUED',
    ...over,
  };
}

function build(revSales: CanonicalSaleRevenue[], cogsSales: RestatedSaleCogs[]) {
  const costingSummary = summarizeRestatedCogs(cogsSales);
  return buildProfitabilityReport({
    tenantId: T,
    stationIds: [S],
    fromDate: '2026-10-01',
    toDate: '2026-10-01',
    revenue: summarizeCanonicalRevenue(revSales),
    costing: { ...costingSummary, sales: cogsSales },
  });
}

describe('buildProfitabilityReport', () => {
  it('computes exact gross margin without any expense term', () => {
    const report = build([rev('123.4567')], [cogs()]);
    expect(report.grossMargin).toBe('42.0833');
    expect(report.grossMarginStatus).toBe('COMPLETE');
    expect(report.expensesIncluded).toBe(false);
    expect(report.costing.restatedCogs).toBe('81.3734');
    expect(report).not.toHaveProperty('expenses');
  });

  it('keeps 0.1 + 0.2 style sums exact', () => {
    const report = build(
      [rev('0.1000', 1), rev('0.2000', 2)],
      [
        cogs({ originalCogs: '0.1000', revaluationDelta: '0.0000', restatedCogs: '0.1000' }),
        cogs({ originalCogs: '0.0500', revaluationDelta: '0.0000', restatedCogs: '0.0500' }),
      ],
    );
    expect(report.revenue.recognizedRevenue).toBe('0.3000');
    expect(report.grossMargin).toBe('0.1500');
  });

  it('reports NOT_APPLICABLE with a null margin when there are no sales', () => {
    const report = build([], []);
    expect(report.grossMargin).toBeNull();
    expect(report.grossMarginStatus).toBe('NOT_APPLICABLE');
    expect(report.revenue.revenueStatus).toBe('NO_SALES');
    expect(report.costing.costingStatus).toBe('NO_SALES');
  });

  it('refuses a partial margin when any sale is unvalued', () => {
    const report = build(
      [rev('10.0000', 1), rev('10.0000', 2)],
      [
        cogs(),
        cogs({
          valuationStatus: 'UNVALUED',
          originalCogs: null,
          revaluationDelta: null,
          restatedCogs: null,
          attributionId: null,
          currency: null,
        }),
      ],
    );
    expect(report.grossMargin).toBeNull();
    expect(report.grossMarginStatus).toBe('COSTING_UNVALUED');
    expect(report.costing.unvaluedSaleCount).toBe(1);
  });

  it('flags missing revenue and sale-count mismatch distinctly', () => {
    expect(build([], [cogs()]).grossMarginStatus).toBe('REVENUE_MISSING');
    expect(build([rev('10.0000')], []).grossMarginStatus).toBe('SALE_COUNT_MISMATCH');
    expect(build([rev('10.0000', 1), rev('5.0000', 2)], [cogs()]).grossMarginStatus).toBe(
      'SALE_COUNT_MISMATCH',
    );
  });

  it('allows a negative margin and an exactly zero margin', () => {
    expect(build([rev('50.0000')], [cogs()]).grossMargin).toBe('-31.3734');
    expect(build([rev('81.3734')], [cogs()]).grossMargin).toBe('0.0000');
  });

  it('classifyGrossMargin mirrors calculateGrossMargin nullness', () => {
    const revenue = summarizeCanonicalRevenue([rev('1.0000')]);
    const costing = summarizeRestatedCogs([cogs()]);
    expect(classifyGrossMargin(revenue, costing)).toBe('COMPLETE');
  });

  it('groups exact fuel revenue and cost into fuel profit rows', () => {
    const rows = buildFuelProfitRows(
      [
        rev('0.1000', 1),
        {
          ...rev('0.2000', 2),
          productId: '00000000-0000-4000-8000-0000000000cc',
          productCode: 'DSL',
          productName: 'Diesel',
        },
      ],
      [
        cogs({ originalCogs: '0.0500', restatedCogs: '0.0500' }),
        {
          ...cogs({ originalCogs: '0.1000', restatedCogs: '0.1000' }),
          productId: '00000000-0000-4000-8000-0000000000cc',
          productCode: 'DSL',
          productName: 'Diesel',
        },
      ],
    );
    expect(rows[0]).toMatchObject({
      productCode: 'DSL',
      revenue: '0.2000',
      cost: '0.1000',
      profit: '0.1000',
      status: 'COMPLETE',
    });
    expect(rows[1]).toMatchObject({
      productCode: 'PMS',
      revenue: '0.1000',
      cost: '0.0500',
      profit: '0.0500',
      status: 'COMPLETE',
    });
  });

  it('keeps fuel profit unavailable when a sale lacks authoritative cost', () => {
    const rows = buildFuelProfitRows(
      [rev('10.0000')],
      [
        cogs({
          valuationStatus: 'UNVALUED',
          originalCogs: null,
          restatedCogs: null,
          currency: null,
        }),
      ],
    );
    expect(rows[0]).toMatchObject({
      status: 'COSTING_UNVALUED',
      cost: null,
      profit: null,
      revenue: '10.0000',
    });
  });
});
