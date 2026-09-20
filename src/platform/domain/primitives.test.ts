import { describe, expect, it } from 'vitest';
import { ExactDecimal, businessDate, litres, money } from './primitives';

describe('exact domain primitives', () => {
  it('keeps decimal arithmetic exact at the application boundary', () => {
    const result = new ExactDecimal('0.1').add(new ExactDecimal('0.2'));
    expect(result.toString()).toBe('0.3');
  });

  it('rejects binary-number inputs by requiring decimal strings', () => {
    expect(() => new ExactDecimal(0.1 as unknown as string)).toThrow();
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
