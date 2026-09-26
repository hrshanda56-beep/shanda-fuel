import { describe, expect, it } from 'vitest';
import { normalizeValuedSaleCogs, summarizeRestatedCogs } from './domain';
import type { RestatedSaleCogs } from './contracts';

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

describe('canonical restated COGS reporting', () => {
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
