import { describe, expect, it } from 'vitest';
import {
  calculateGrossMargin,
  normalizeValuedSaleCogs,
  summarizeCanonicalRevenue,
  summarizeRestatedCogs,
} from './domain';
import type { CanonicalSaleRevenue, RestatedSaleCogs } from './contracts';

function sale(overrides: Partial<RestatedSaleCogs> = {}): RestatedSaleCogs {
  return {
    stationId: '00000000-0000-4000-8000-000000000000',
    reconciliationId: '00000000-0000-4000-8000-000000000001',
    revisionId: '00000000-0000-4000-8000-000000000002',
    meterSegmentId: '00000000-0000-4000-8000-000000000003',
    saleMovementId: '00000000-0000-4000-8000-000000000004',
    attributionId: '00000000-0000-4000-8000-000000000005',
    originalSaleCogsEventId: '00000000-0000-4000-8000-000000000006',
    originalCogs: '10.0000',
    revaluationDelta: '0.0000',
    revaluationLineIds: [],
    revaluationEventIds: [],
    restatedCogs: '10.0000',
    businessDate: '2026-09-20',
    effectiveAt: '2026-09-20T07:00:00.000Z',
    currency: 'USD',
    valuationStatus: 'VALUED',
    ...overrides,
  };
}

function revenue(overrides: Partial<CanonicalSaleRevenue> = {}): CanonicalSaleRevenue {
  return {
    stationId: '00000000-0000-4000-8000-000000000000',
    reconciliationId: '00000000-0000-4000-8000-000000000001',
    revisionId: '00000000-0000-4000-8000-000000000002',
    meterSegmentId: '00000000-0000-4000-8000-000000000003',
    revenueMovementId: '00000000-0000-4000-8000-000000000004',
    recognizedRevenue: '1.2345',
    quantityLitres: '1.000',
    businessDate: '2026-09-20',
    effectiveAt: '2026-09-20T07:00:00.000Z',
    currency: 'USD',
    ...overrides,
  };
}

describe('canonical restated COGS reporting', () => {
  it('summarizes canonical revenue without using operational sales evidence', () => {
    expect(
      summarizeCanonicalRevenue([
        revenue(),
        revenue({
          meterSegmentId: '00000000-0000-4000-8000-000000000007',
          revenueMovementId: '00000000-0000-4000-8000-000000000008',
          recognizedRevenue: '2.3456',
        }),
      ]),
    ).toMatchObject({
      revenueStatus: 'POSTED',
      recognizedRevenue: '3.5801',
      saleCount: 2,
    });
  });

  it('calculates exact gross margin from recognized revenue and restated COGS', () => {
    const canonicalRevenue = summarizeCanonicalRevenue([revenue()]);
    const costing = summarizeRestatedCogs([
      sale({ originalCogs: '0.0001', restatedCogs: '0.0001' }),
    ]);
    expect(calculateGrossMargin(canonicalRevenue, costing)).toBe('1.2344');
  });

  it('does not publish a margin for no-sales or unvalued periods', () => {
    const noRevenue = summarizeCanonicalRevenue([]);
    const noSales = summarizeRestatedCogs([]);
    expect(calculateGrossMargin(noRevenue, noSales)).toBeNull();
    expect(
      calculateGrossMargin(
        summarizeCanonicalRevenue([revenue()]),
        summarizeRestatedCogs([
          sale({
            valuationStatus: 'UNVALUED',
            attributionId: null,
            originalSaleCogsEventId: null,
            originalCogs: null,
            revaluationDelta: null,
            restatedCogs: null,
          }),
        ]),
      ),
    ).toBeNull();
  });

  it('returns a distinct zero-valued no-sales result', () => {
    expect(summarizeRestatedCogs([])).toEqual({
      currency: 'USD',
      costingStatus: 'NO_SALES',
      originalCogs: '0.0000',
      revaluationDelta: '0.0000',
      restatedCogs: '0.0000',
      saleCount: 0,
      valuedSaleCount: 0,
      unvaluedSaleCount: 0,
    });
  });

  it('accumulates signed sequential revaluations exactly', () => {
    const first = normalizeValuedSaleCogs({ originalCogs: '10.0000', revaluationDelta: '1.0050' });
    const second = normalizeValuedSaleCogs({
      originalCogs: '20.0000',
      revaluationDelta: '-0.0050',
    });

    expect(first).toEqual({
      originalCogs: '10.0000',
      revaluationDelta: '1.0050',
      restatedCogs: '11.0050',
    });
    expect(second).toEqual({
      originalCogs: '20.0000',
      revaluationDelta: '-0.0050',
      restatedCogs: '19.9950',
    });
    expect(
      summarizeRestatedCogs([
        sale(first),
        sale({
          saleMovementId: '00000000-0000-4000-8000-000000000007',
          ...second,
        }),
      ]),
    ).toMatchObject({
      costingStatus: 'COMPLETE',
      originalCogs: '30.0000',
      revaluationDelta: '1.0000',
      restatedCogs: '31.0000',
    });
  });

  it('does not publish a partial aggregate when any sale is unvalued', () => {
    expect(
      summarizeRestatedCogs([
        sale(),
        sale({
          saleMovementId: '00000000-0000-4000-8000-000000000007',
          valuationStatus: 'UNVALUED',
          attributionId: null,
          originalSaleCogsEventId: null,
          originalCogs: null,
          revaluationDelta: null,
          restatedCogs: null,
        }),
      ]),
    ).toMatchObject({
      costingStatus: 'UNVALUED',
      originalCogs: null,
      revaluationDelta: null,
      restatedCogs: null,
      saleCount: 2,
      valuedSaleCount: 1,
      unvaluedSaleCount: 1,
    });
  });
});
