import { describe, expect, it } from 'vitest';
import { formatTileMoney } from './format';

describe('formatTileMoney', () => {
  it('shows two decimals with thousands separators', () => {
    expect(formatTileMoney('0.0000')).toBe('USD 0.00');
    expect(formatTileMoney('1245.5000')).toBe('USD 1,245.50');
    expect(formatTileMoney('1234567.891')).toBe('USD 1,234,567.89');
  });

  it('rounds half up on exact decimals, not binary floats', () => {
    expect(formatTileMoney('1.005')).toBe('USD 1.01');
    expect(formatTileMoney('0.1250')).toBe('USD 0.13');
  });

  it('handles negatives and missing values', () => {
    expect(formatTileMoney('-1245.5')).toBe('USD -1,245.50');
    expect(formatTileMoney('-0.0001')).toBe('USD 0.00');
    expect(formatTileMoney(null)).toBe('USD 0.00');
  });
});
