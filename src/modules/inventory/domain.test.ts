import { describe, expect, it } from 'vitest';
import {
  assertMovementFitsTank,
  assertWithinTankCapacity,
  calculateDeliveryShortageExcess,
  calculateTankStockVariance,
  deriveExpectedTankStock,
  requireAdjustmentReason,
  validateDeliveryDipWindow,
  validateDeliveryAllocations,
  validateMovementQuantity,
} from './domain';

describe('inventory domain', () => {
  it('derives exact tank stock and variance without binary floating point', () => {
    const expected = deriveExpectedTankStock('10000.00', [
      { movementType: 'DELIVERY', quantityLitres: '5000.00' },
      { movementType: 'SALE', quantityLitres: '-500.00' },
    ]);
    expect(expected).toBe('14500');
    expect(calculateTankStockVariance('14480.00', expected)).toBe('-20');
  });

  it('validates movement direction, allocation totals, capacity, and adjustment reasons', () => {
    expect(validateMovementQuantity('DELIVERY', '500.125')).toBe('500.125');
    expect(() => validateMovementQuantity('SALE', '500')).toThrow('must be negative');
    expect(validateDeliveryAllocations('10000', ['6000', '4000.000'])).toBe('10000');
    expect(() => validateDeliveryAllocations('10000', ['10001'])).toThrow('exceed');
    expect(() => assertWithinTankCapacity('10001', '10000')).toThrow('capacity');
    expect(requireAdjustmentReason('  dip correction  ')).toBe('dip correction');
    expect(() => requireAdjustmentReason('')).toThrow('require a reason');
  });

  it('rejects negative stock rather than clamping it', () => {
    expect(() =>
      deriveExpectedTankStock('100', [{ movementType: 'SALE', quantityLitres: '-100.001' }]),
    ).toThrow('negative stock');
  });

  describe('assertMovementFitsTank', () => {
    const at = (hour: number) => new Date(`2026-10-28T${String(hour).padStart(2, '0')}:00:00Z`);
    const history = [
      { movementType: 'OPENING_BALANCE', quantityLitres: '1000', effectiveAt: at(6) },
      { movementType: 'SALE', quantityLitres: '-600', effectiveAt: at(12) },
    ] as const;

    it('accepts a movement that keeps every point between zero and capacity', () => {
      expect(() =>
        assertMovementFitsTank(
          history,
          { movementType: 'DELIVERY', quantityLitres: '4000', effectiveAt: at(10) },
          '5000',
        ),
      ).not.toThrow();
    });

    it('refuses an issue dated before the stock that covers it, even though the total stays positive', () => {
      expect(() =>
        assertMovementFitsTank(
          [...history, { movementType: 'DELIVERY', quantityLitres: '2000', effectiveAt: at(14) }],
          { movementType: 'NEGATIVE_ADJUSTMENT', quantityLitres: '-500', effectiveAt: at(13) },
          '5000',
        ),
      ).toThrow('less than zero litres');
    });

    it('refuses a delivery that would overfill the tank, and says the capacity', () => {
      expect(() =>
        assertMovementFitsTank(
          history,
          { movementType: 'DELIVERY', quantityLitres: '4700', effectiveAt: at(7) },
          '5000',
        ),
      ).toThrow('(5000 L)');
    });

    it('refuses a delivery that would only overfill the tank at a later point', () => {
      expect(() =>
        assertMovementFitsTank(
          history,
          { movementType: 'DELIVERY', quantityLitres: '4300', effectiveAt: at(11) },
          '5000',
        ),
      ).toThrow('than it can hold');
    });

    it('does not judge older history when a sale is added', () => {
      expect(() =>
        assertMovementFitsTank(
          [{ movementType: 'OPENING_BALANCE', quantityLitres: '9000', effectiveAt: at(6) }],
          { movementType: 'SALE', quantityLitres: '-100', effectiveAt: at(7) },
          '5000',
        ),
      ).not.toThrow();
    });
  });

  it('calculates delivery shortage/excess as actual minus note quantity', () => {
    expect(calculateDeliveryShortageExcess('10000', '9995.5')).toBe('-4.5');
  });

  it('requires delivery dips to bracket the delivery timestamp', () => {
    expect(() =>
      validateDeliveryDipWindow(
        '2026-10-28T08:00:00+02:00',
        '2026-10-28T07:59:00+02:00',
        '2026-10-28T08:01:00+02:00',
      ),
    ).not.toThrow();
    expect(() =>
      validateDeliveryDipWindow('2026-10-28T08:00:00+02:00', '2026-10-28T08:01:00+02:00'),
    ).toThrow('before-delivery');
    expect(() =>
      validateDeliveryDipWindow(
        '2026-10-28T08:00:00+02:00',
        undefined,
        '2026-10-28T07:59:00+02:00',
      ),
    ).toThrow('after-delivery');
  });
});
