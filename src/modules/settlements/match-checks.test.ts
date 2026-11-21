import { describe, expect, it } from 'vitest';
import { checkMatchAmount, checkMatchPayment, checkMatchPayout } from './match-checks';

describe('match a payment checks', () => {
  it('needs a payout and a payment', () => {
    expect(checkMatchPayout('')).toHaveProperty('settlement');
    expect(checkMatchPayout('s1')).toEqual({});
    expect(checkMatchPayment('')).toHaveProperty('payment');
    expect(checkMatchPayment('p1')).toEqual({});
  });

  it('needs an amount above zero and not above what is left', () => {
    expect(checkMatchAmount('', '100')).toHaveProperty('allocation-amount');
    expect(checkMatchAmount('abc', '100')).toHaveProperty('allocation-amount');
    expect(checkMatchAmount('0', '100')).toHaveProperty('allocation-amount');
    expect(checkMatchAmount('100.01', '100')).toHaveProperty('allocation-amount');
    expect(checkMatchAmount('100', '100')).toEqual({});
    expect(checkMatchAmount('99.9999', '100.0000')).toEqual({});
    expect(checkMatchAmount('5', null)).toEqual({});
  });
});
