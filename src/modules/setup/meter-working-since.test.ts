import { describe, expect, it } from 'vitest';
import {
  checkMeterWorkingSinceDate,
  describeMeterWorkingSince,
  MAX_BACKDATE_DAYS,
} from './meter-working-since';

describe('checkMeterWorkingSinceDate', () => {
  const today = '2026-10-29';

  it('accepts today and earlier dates within the allowed window', () => {
    expect(checkMeterWorkingSinceDate('2026-10-29', today)).toBeNull();
    expect(checkMeterWorkingSinceDate('2026-10-01', today)).toBeNull();
    expect(checkMeterWorkingSinceDate('2025-10-29', today)).toBeNull();
  });

  it('rejects a date in the future', () => {
    expect(checkMeterWorkingSinceDate('2026-10-30', today)).toMatch(/cannot be in the future/i);
  });

  it('rejects a date that is not a real calendar day', () => {
    expect(checkMeterWorkingSinceDate('2026-02-30', today)).toMatch(/real date/i);
    expect(checkMeterWorkingSinceDate('not-a-date', today)).toMatch(/real date/i);
  });

  it('rejects a date further back than the allowed window', () => {
    expect(MAX_BACKDATE_DAYS).toBe(366);
    expect(checkMeterWorkingSinceDate('2025-10-28', today)).toBeNull();
    expect(checkMeterWorkingSinceDate('2025-10-27', today)).toMatch(/more than a year/i);
  });
});

describe('describeMeterWorkingSince', () => {
  it('writes the station date in plain words', () => {
    expect(describeMeterWorkingSince('2026-10-29')).toBe('29 Oct 2026');
  });

  it('says nothing is set when there is no date', () => {
    expect(describeMeterWorkingSince(null)).toBe('Not set');
  });
});
