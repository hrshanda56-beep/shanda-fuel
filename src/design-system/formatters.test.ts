import { describe, expect, it } from 'vitest';

import {
  formatBusinessDate,
  formatDecimal,
  formatLitres,
  formatMoney,
  formatUsd,
  formatPercentage,
  formatStatusLabel,
  formatTimeInTimeZone,
} from './formatters';

describe('presentation formatters', () => {
  it('preserves decimal text while adding readable grouping and units', () => {
    expect(formatDecimal('1234567.8900')).toBe('1,234,567.8900');
    expect(formatMoney('12500.00')).toBe('USD 12,500.00');
    expect(formatUsd('7460')).toBe('$7,460');
    expect(formatUsd('-212.40')).toBe('−$212.40');
    expect(formatUsd('abc')).toBe('—');
    expect(formatLitres('1050.375')).toBe('1,050.375 L');
    expect(formatPercentage('4.25')).toBe('4.25%');
  });

  it('rejects malformed authoritative values instead of guessing', () => {
    expect(formatDecimal('not-a-number')).toBe('—');
  });

  it('keeps date-only business dates stable across viewer timezones', () => {
    const originalTimezone = process.env.TZ;

    try {
      for (const timezone of [
        'UTC',
        'Africa/Harare',
        'America/Los_Angeles',
        'Pacific/Kiritimati',
      ]) {
        process.env.TZ = timezone;
        expect(formatBusinessDate('2026-09-20', 'en-GB')).toBe('20 Sept 2026');
      }
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('rejects malformed and impossible business dates', () => {
    expect(formatBusinessDate('20/09/2026')).toBe('—');
    expect(formatBusinessDate('2026-02-30')).toBe('—');
  });

  it('keeps station-displayed time stable across viewer timezones', () => {
    const originalTimezone = process.env.TZ;

    try {
      for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = timezone;
        expect(formatTimeInTimeZone('2026-09-23T06:00:00.000Z', 'Africa/Harare')).toBe('08:00');
      }
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('formats an instant in the known station timezone', () => {
    expect(formatTimeInTimeZone('2026-01-15T17:05:00.000Z', 'America/New_York')).toBe('12:05');
  });

  it('shows an unavailable marker when the station timezone is missing', () => {
    expect(formatTimeInTimeZone('2026-09-23T06:00:00.000Z', undefined)).toBe('—');
    expect(formatTimeInTimeZone('2026-09-23T06:00:00.000Z', null)).toBe('—');
  });

  it('labels statuses', () => {
    expect(formatStatusLabel('PENDING_APPROVAL')).toBe('Pending Approval');
  });
});
