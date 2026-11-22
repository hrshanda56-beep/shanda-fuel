import { describe, expect, it } from 'vitest';
import {
  checkAdjustmentQuantity,
  checkAdjustmentReason,
  stockAfterAdjustment,
} from './adjustment-checks';

describe('stock correction checks', () => {
  it('needs a positive number', () => {
    expect(checkAdjustmentQuantity('', 'POSITIVE_ADJUSTMENT', '100', 'litres')).toHaveProperty(
      'adj-quantity',
    );
    expect(checkAdjustmentQuantity('0', 'POSITIVE_ADJUSTMENT', '100', 'litres')).toHaveProperty(
      'adj-quantity',
    );
    expect(checkAdjustmentQuantity('12.5', 'POSITIVE_ADJUSTMENT', '100', 'litres')).toEqual({});
  });
  it('refuses taking away more than the books hold', () => {
    expect(checkAdjustmentQuantity('150', 'NEGATIVE_ADJUSTMENT', '100', 'litres')).toHaveProperty(
      'adj-quantity',
    );
    expect(checkAdjustmentQuantity('150', 'POSITIVE_ADJUSTMENT', '100', 'litres')).toEqual({});
  });
  it('needs a reason', () => {
    expect(checkAdjustmentReason(' a ')).toHaveProperty('adj-reason');
    expect(checkAdjustmentReason('Spillage')).toEqual({});
  });
  it('works out the stock afterwards', () => {
    expect(stockAfterAdjustment('1000', '250.5', 'NEGATIVE_ADJUSTMENT')).toBe(749.5);
    expect(stockAfterAdjustment('1000', '250', 'POSITIVE_ADJUSTMENT')).toBe(1250);
  });
});
