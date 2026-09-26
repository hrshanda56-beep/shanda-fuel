import { describe, expect, it } from 'vitest';
import { ExactDecimal } from '../../platform/domain/primitives';
import { deriveOrdinaryFuelSaleRevenue, revenueReplayFingerprint } from './domain';

describe('canonical sale revenue', () => {
  it('derives one exact amount per segment rather than from a reading total', () => {
    expect(
      deriveOrdinaryFuelSaleRevenue({ quantityLitres: '250.000', unitPrice: '1.234567' }),
    ).toMatchObject({
      quantityLitres: '250',
      unitPrice: '1.234567',
      reconciliationValue: '308.6418',
      recognizedRevenueAmount: '308.6418',
      currency: 'USD',
    });
  });

  it('rounds only at the money boundary', () => {
    expect(
      deriveOrdinaryFuelSaleRevenue({ quantityLitres: '1.000', unitPrice: '1.23455' })
        .recognizedRevenueAmount,
    ).toBe('1.2346');
  });

  it('keeps price-change segments separate instead of applying one reading price', () => {
    const first = deriveOrdinaryFuelSaleRevenue({
      quantityLitres: '100.000',
      unitPrice: '1.500000',
    });
    const second = deriveOrdinaryFuelSaleRevenue({
      quantityLitres: '100.000',
      unitPrice: '1.600000',
    });
    expect(
      new ExactDecimal(first.recognizedRevenueAmount)
        .add(new ExactDecimal(second.recognizedRevenueAmount))
        .toString(),
    ).toBe('310');
    expect(
      deriveOrdinaryFuelSaleRevenue({ quantityLitres: '200.000', unitPrice: '1.600000' })
        .recognizedRevenueAmount,
    ).toBe('320');
  });

  it('rejects zero or negative segments', () => {
    expect(() =>
      deriveOrdinaryFuelSaleRevenue({ quantityLitres: '0.000', unitPrice: '1.000000' }),
    ).toThrow('positive litres');
    expect(() =>
      deriveOrdinaryFuelSaleRevenue({ quantityLitres: '1.000', unitPrice: '0.000000' }),
    ).toThrow('positive price');
  });

  it('fingerprints the immutable economic payload deterministically', () => {
    const input = {
      tenantId: 'tenant',
      legalEntityId: 'legal',
      stationId: 'station',
      businessDate: '2026-01-01',
      productId: 'product',
      tankId: 'tank',
      nozzleId: 'nozzle',
      shiftId: 'shift',
      meterSegmentId: 'segment',
      inventorySaleMovementId: 'movement',
      reconciliationId: 'reconciliation',
      reconciliationRevisionId: 'revision',
      reconciliationMeterReadingId: 'reading',
      quantityLitres: '10.000',
      unitPrice: '1.234500',
      reconciliationValue: '12.3450',
      recognizedRevenueAmount: '12.3450',
      currency: 'USD' as const,
      effectiveAt: '2026-01-01T00:00:00.000Z',
      classification: 'ORDINARY_FUEL_SALE' as const,
      sourceType: 'METER_SEGMENT_SALE' as const,
    };
    expect(revenueReplayFingerprint(input)).toBe(revenueReplayFingerprint({ ...input }));
    expect(revenueReplayFingerprint({ ...input, recognizedRevenueAmount: '12.3451' })).not.toBe(
      revenueReplayFingerprint(input),
    );
  });
});
