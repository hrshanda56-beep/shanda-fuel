import { describe, expect, it } from 'vitest';
import {
  assertWithinTankCapacity,
  calculateDeliveryShortageExcess,
  calculateTankStockVariance,
  deriveExpectedTankStock,
  requireAdjustmentReason,
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

  it('calculates delivery shortage/excess as actual minus note quantity', () => {
    expect(calculateDeliveryShortageExcess('10000', '9995.5')).toBe('-4.5');
  });
});
