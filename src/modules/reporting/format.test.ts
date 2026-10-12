import { describe, expect, it } from 'vitest';
import { formatReportLitres, formatTileLitres, formatTileMoney } from './format';

describe('formatReportLitres', () => {
  it('distinguishes unavailable measurements from measured zero', () => {
    expect(formatReportLitres(null)).toBe('Unavailable');
    expect(formatReportLitres('0.000')).toBe('0.000 L');
  });
});

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
  });

  it('never turns a missing or malformed amount into zero', () => {
    expect(formatTileMoney(null)).toBe('—');
    expect(formatTileMoney(undefined)).toBe('—');
    expect(formatTileMoney('')).toBe('—');
    expect(formatTileMoney('not a number')).toBe('—');
    expect(formatTileMoney(' 12.5 ', 'ZWG')).toBe('ZWG 12.50');
  });
});

describe('formatTileLitres', () => {
  it('rounds exact decimals to whole litres with separators', () => {
    expect(formatTileLitres('1284.499')).toBe('1,284 L');
    expect(formatTileLitres('1284.5')).toBe('1,285 L');
    expect(formatTileLitres('0.000')).toBe('0 L');
  });

  it('keeps the sign for negative variances', () => {
    expect(formatTileLitres('-12.6')).toBe('−13 L');
    expect(formatTileLitres('-0.2')).toBe('0 L');
  });

  it('never turns a missing value into zero', () => {
    expect(formatTileLitres(null)).toBe('—');
    expect(formatTileLitres(undefined)).toBe('—');
    expect(formatTileLitres('')).toBe('—');
  });
});
