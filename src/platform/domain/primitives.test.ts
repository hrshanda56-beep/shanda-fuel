import { describe, expect, it } from 'vitest';
import {
  DECIMAL_POLICIES,
  ExactDecimal,
  businessDate,
  litres,
  money,
  unitPrice,
  weightedAverageCost,
} from './primitives';

describe('exact domain primitives', () => {
  it('keeps decimal addition and multiplication free of IEEE-754 drift', () => {
    expect(new ExactDecimal('0.1').add(new ExactDecimal('0.2')).toString()).toBe('0.3');
    expect(new ExactDecimal('0.1').multiply(new ExactDecimal('0.2')).toString()).toBe('0.02');
  });

  it('rejects binary-number inputs by requiring decimal strings', () => {
    expect(() => new ExactDecimal(0.1 as unknown as string)).toThrow();
  });

  it('accepts the maximum configured scale and precision for each domain', () => {
    expect(money('9999999999999999.9999').amount.toString()).toBe('9999999999999999.9999');
    expect(litres('999999999999999.999').toString()).toBe('999999999999999.999');
    expect(unitPrice('99999999999999.999999').toString()).toBe('99999999999999.999999');
    expect(weightedAverageCost('999999999999.99999999').toString()).toBe('999999999999.99999999');
  });

  it('rejects excess scale instead of silently rounding business values', () => {
    expect(() => money('1.00001')).toThrow(/Money accepts at most 4/);
    expect(() => litres('1.0001')).toThrow(/Litres accepts at most 3/);
    expect(() => unitPrice('1.0000001')).toThrow(/UnitPrice accepts at most 6/);
    expect(() => weightedAverageCost('1.000000001')).toThrow(
      /WeightedAverageCost accepts at most 8/,
    );
  });

  it('rejects values exceeding the configured integer precision', () => {
    expect(() => money('10000000000000000.0000')).toThrow(
      /Money accepts at most 16 integer digits/,
    );
  });

  it('supports explicit quantization with a named rounding policy', () => {
    const value = new ExactDecimal('1.2345');
    expect(value.quantize(DECIMAL_POLICIES.litres, 'half-up').toString()).toBe('1.235');
    expect(value.quantize(DECIMAL_POLICIES.litres, 'down').toString()).toBe('1.234');
  });

  it('keeps money and litres explicit', () => {
    expect(money('10.25')).toMatchObject({ currency: 'USD' });
    expect(litres('42.500').toString()).toBe('42.5');
  });

  it('validates station-local business date format', () => {
    expect(businessDate('2026-09-20')).toBe('2026-09-20');
    expect(() => businessDate('20/09/2026')).toThrow();
  });
});
