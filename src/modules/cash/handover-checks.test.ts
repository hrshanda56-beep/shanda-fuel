import { describe, expect, it } from 'vitest';
import {
  checkHandoverAmounts,
  checkHandoverFrom,
  checkHandoverReason,
  checkHandoverTo,
  handoverDiffers,
} from './handover-checks';

describe('cash handover checks', () => {
  it('needs a place the cash is coming from', () => {
    expect(checkHandoverFrom('')).toHaveProperty('ho-from');
    expect(checkHandoverFrom('a')).toEqual({});
  });

  it('needs a different place to hand it to', () => {
    expect(checkHandoverTo('a', '')).toHaveProperty('ho-to');
    expect(checkHandoverTo('a', 'a')).toHaveProperty('ho-to');
    expect(checkHandoverTo('a', 'b')).toEqual({});
  });

  it('needs an amount above zero to hand over and a counted amount', () => {
    expect(checkHandoverAmounts('', '')).toHaveProperty('ho-expected');
    expect(checkHandoverAmounts('', '')).toHaveProperty('ho-counted');
    expect(checkHandoverAmounts('0', '10')).toHaveProperty('ho-expected');
    expect(checkHandoverAmounts('12a', '10')).toHaveProperty('ho-expected');
    expect(checkHandoverAmounts('10', '0')).toEqual({});
    expect(checkHandoverAmounts('1500.50', '1500.5')).toEqual({});
  });

  it('asks for a reason only when the counted amount differs', () => {
    expect(handoverDiffers('100', '100.00')).toBe(false);
    expect(handoverDiffers('100', '90')).toBe(true);
    expect(checkHandoverReason('100', '100', '')).toEqual({});
    expect(checkHandoverReason('100', '90', '')).toHaveProperty('ho-reason');
    expect(checkHandoverReason('100', '90', 'Short by change given')).toEqual({});
  });
});
