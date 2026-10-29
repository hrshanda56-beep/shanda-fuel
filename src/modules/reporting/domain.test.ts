import { describe, expect, it } from 'vitest';
import {
  averageRealizedPrice,
  customerScopeAvailability,
  deriveCashPosition,
  formatLitres,
  formatMoney,
  latestStationLocalDate,
  normalizeStationIds,
  sumObservedExact,
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

  it('keeps missing physical observations unavailable while preserving measured zero', () => {
    expect(sumObservedExact([])).toBe('0');
    expect(sumObservedExact(['0.000', '12.500'])).toBe('12.5');
    expect(sumObservedExact(['12.500', null])).toBeNull();
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
      deposited: '50.0000',
      banked: '50.0000',
      collectedButNotBanked: '30.0000',
      cashVariance: '-2.0000',
    });
  });

  it('keeps deposits awaiting confirmation out of cash still at stations', () => {
    expect(
      deriveCashPosition({
        evidence: '100.00',
        collected: '80.00',
        deposited: '60.00',
        banked: '20.00',
        variance: '0.00',
      }),
    ).toMatchObject({
      deposited: '60.0000',
      banked: '20.0000',
      collectedButNotBanked: '20.0000',
    });
  });

  it('keeps classified cash buckets equal to total collections', () => {
    const position = deriveCashPosition({
      evidence: '100.00',
      collected: '100.00',
      deposited: '30.00',
      banked: '20.00',
      atStation: '60.00',
      heldByManagement: '10.00',
      inTransit: '10.00',
      variance: '0.00',
    });

    expect(
      formatMoney(
        sumExact([
          position.atStation,
          position.heldByManagement,
          position.inTransit,
          position.banked,
        ]),
      ),
    ).toBe(position.collected);
  });

  it('marks station-scoped customer balances unavailable instead of zero', () => {
    expect(customerScopeAvailability()).toBe('AVAILABLE');
    expect(customerScopeAvailability(['station-1', 'station-2'])).toBe(
      'UNAVAILABLE_STATION_DIMENSION',
    );
  });
});

describe('station scope normalisation', () => {
  it('merges the legacy station with the list, sorted and de-duplicated', () => {
    expect(normalizeStationIds('b', ['c', 'a', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('treats no stations as every station', () => {
    expect(normalizeStationIds(undefined, undefined)).toEqual([]);
    expect(normalizeStationIds(undefined, [])).toEqual([]);
  });
});

describe('latestStationLocalDate', () => {
  const lateEveningUtc = new Date('2026-10-29T23:30:00Z');

  it('uses the station local date, which can be ahead of UTC', () => {
    expect(latestStationLocalDate(lateEveningUtc, ['Africa/Harare'])).toBe('2026-10-30');
  });

  it('uses the latest date when stations are in different time zones', () => {
    expect(latestStationLocalDate(lateEveningUtc, ['America/New_York', 'Africa/Harare'])).toBe(
      '2026-10-30',
    );
  });

  it('can be behind UTC too', () => {
    expect(latestStationLocalDate(new Date('2026-10-30T01:00:00Z'), ['America/Los_Angeles'])).toBe(
      '2026-10-29',
    );
  });

  it('skips unknown time zones and falls back to UTC when none are usable', () => {
    expect(latestStationLocalDate(lateEveningUtc, ['Mars/Olympus'])).toBe('2026-10-29');
    expect(latestStationLocalDate(lateEveningUtc, [])).toBe('2026-10-29');
  });
});
