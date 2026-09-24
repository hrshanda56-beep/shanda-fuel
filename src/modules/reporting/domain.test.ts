import { describe, expect, it } from 'vitest';
import {
  averageRealizedPrice,
  customerScopeAvailability,
  deriveCashPosition,
  formatLitres,
  formatMoney,
  sumExact,
} from './domain';

describe('management reporting exact arithmetic', () => {
  it('aggregates decimal strings without IEEE-754 drift', () => {
    expect(sumExact(['0.1', '0.2', '1.005'])).toBe('1.305');
  });

  it('serializes authoritative values at canonical scales', () => {
    expect(formatMoney('12.3')).toBe('12.3000');
    expect(formatLitres('12.3')).toBe('12.300');
    expect(averageRealizedPrice('3', '10')).toBe('3.333333');
  });

  it('returns an empty zero report rather than null arithmetic', () => {
    expect(formatMoney(sumExact([]))).toBe('0.0000');
    expect(formatLitres(sumExact([]))).toBe('0.000');
  });

  it('keeps cash evidence, collection, and banking as separate facts', () => {
    expect(
      deriveCashPosition({
        evidence: '100.00',
        collected: '80.00',
        banked: '50.00',
        variance: '-2.00',
      }),
    ).toEqual({
      cashEvidence: '100.0000',
      collected: '80.0000',
      awaitingCollection: '20.0000',
      banked: '50.0000',
      collectedButNotBanked: '30.0000',
      cashVariance: '-2.0000',
    });
  });

  it('marks station-scoped customer balances unavailable instead of zero', () => {
    expect(customerScopeAvailability()).toBe('AVAILABLE');
    expect(customerScopeAvailability('station-1')).toBe('UNAVAILABLE_STATION_DIMENSION');
  });
});
