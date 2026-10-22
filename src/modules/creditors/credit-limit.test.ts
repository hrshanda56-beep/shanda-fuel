import { describe, expect, it } from 'vitest';
import { creditLimitPosition } from './credit-limit';

describe('creditLimitPosition', () => {
  it('does not judge a supplier without a limit', () => {
    expect(creditLimitPosition('500', null)).toMatchObject({ status: 'none', available: null });
  });

  it('is fine below 80% of the limit', () => {
    expect(creditLimitPosition('7999.9999', '10000')).toMatchObject({
      status: 'ok',
      available: '2000.0001',
      percentUsed: 80,
    });
  });

  it('warns from 80% up to and including the limit', () => {
    expect(creditLimitPosition('8000', '10000').status).toBe('near');
    expect(creditLimitPosition('10000', '10000')).toMatchObject({
      status: 'near',
      available: '0',
      percentUsed: 100,
    });
  });

  it('is over only above the limit, and never shows negative room', () => {
    expect(creditLimitPosition('10000.0001', '10000')).toMatchObject({
      status: 'over',
      available: '0',
    });
  });

  it('treats a limit of zero as no credit allowed', () => {
    expect(creditLimitPosition('0', '0')).toMatchObject({ status: 'ok', percentUsed: null });
    expect(creditLimitPosition('1', '0').status).toBe('over');
  });
});
