import { describe, expect, it } from 'vitest';
import {
  assertWithinTankCapacity,
  calculateDeliveryShortageExcess,
  classifyDeliveryReceipt,
  calculateTankStockVariance,
  convertCalibratedMeasurementToLitres,
  deriveExpectedTankStock,
  interpolateCalibrationLitres,
  requireAdjustmentReason,
  validateCalibrationPoints,
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

  it('classifies a partial receipt using exact decimal quantities', () => {
    expect(classifyDeliveryReceipt('10000.000', '9995.500')).toBe('PARTIAL');
    expect(classifyDeliveryReceipt('10000', '10000.000')).toBe('FULL');
    expect(classifyDeliveryReceipt('10000', '10000.001')).toBe('EXCESS');
    expect(() => classifyDeliveryReceipt('-1', '0')).toThrow('cannot be negative');
  });

  it('converts calibrated tank measurements with exact interpolation and unit checks', () => {
    const chart = validateCalibrationPoints([
      { measurementValue: '2000', litres: '20000', measurementUnit: 'mm' },
      { measurementValue: '0', litres: '0', measurementUnit: 'mm' },
    ]);

    expect(interpolateCalibrationLitres('1000', chart)).toBe('10000');
    expect(convertCalibratedMeasurementToLitres('1500', 'mm', chart)).toBe('15000');
    expect(() => convertCalibratedMeasurementToLitres('1000', 'cm', chart)).toThrow(
      'does not match',
    );
    expect(() => interpolateCalibrationLitres('2001', chart)).toThrow('outside');
  });

  it('rejects malformed or non-monotonic calibration charts', () => {
    expect(() =>
      validateCalibrationPoints([
        { measurementValue: '0', litres: '0', measurementUnit: 'mm' },
        { measurementValue: '0', litres: '100', measurementUnit: 'mm' },
      ]),
    ).toThrow('unique');
    expect(() =>
      validateCalibrationPoints([
        { measurementValue: '0', litres: '100', measurementUnit: 'mm' },
        { measurementValue: '1000', litres: '0', measurementUnit: 'mm' },
      ]),
    ).toThrow('monotonic');
    expect(() =>
      validateCalibrationPoints([
        { measurementValue: '0', litres: '0', measurementUnit: 'mm' },
        { measurementValue: '1000', litres: '1000', measurementUnit: 'cm' },
      ]),
    ).toThrow('one measurement unit');
  });
});
