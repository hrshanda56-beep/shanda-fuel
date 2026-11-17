import { describe, expect, it } from 'vitest';
import { creditLimitCells } from './supplier-format';

describe('creditLimitCells (D9)', () => {
  it('says "No limit" and does not judge a supplier without a limit', () => {
    expect(creditLimitCells({ status: 'none', limit: null, available: null })).toEqual({
      limit: 'No limit',
      available: '—',
      over: false,
    });
    expect(creditLimitCells(undefined)).toEqual({ limit: 'No limit', available: '—', over: false });
  });

  it('shows the limit and what can still be bought on credit', () => {
    expect(creditLimitCells({ status: 'ok', limit: '10000.0000', available: '4000' })).toEqual({
      limit: 'USD 10,000.00',
      available: 'USD 4,000.00',
      over: false,
    });
  });

  it('flags a supplier over the limit, with nothing available', () => {
    expect(creditLimitCells({ status: 'over', limit: '5000', available: '0' })).toEqual({
      limit: 'USD 5,000.00',
      available: 'USD 0.00',
      over: true,
    });
  });
});
