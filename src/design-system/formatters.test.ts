import { describe, expect, it } from 'vitest';

import {
  formatBusinessDate,
  formatDecimal,
  formatLitres,
  formatLitresDisplay,
  formatMoney,
  formatMoneyDisplay,
  formatStatusSentence,
  formatUnitPrice,
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

describe('plain display formatters', () => {
  it('formats money to two places without binary floats', () => {
    expect(formatMoneyDisplay('1234.5')).toBe('$1,234.50');
    expect(formatMoneyDisplay('0.0000')).toBe('$0.00');
    expect(formatMoneyDisplay('0.005')).toBe('$0.01');
    expect(formatMoneyDisplay('999.995')).toBe('$1,000.00');
    expect(formatMoneyDisplay('-212.4')).toBe('−$212.40');
    expect(formatMoneyDisplay('-0.001')).toBe('$0.00');
    expect(formatMoneyDisplay('12345678901234567.89')).toBe('$12,345,678,901,234,567.89');
    expect(formatMoneyDisplay('12.5', 'ZWG')).toBe('ZWG 12.50');
    expect(formatMoneyDisplay(null)).toBe('—');
    expect(formatMoneyDisplay('NO_SALES')).toBe('—');
  });

  it('formats litres whole, with one decimal only below ten', () => {
    expect(formatLitresDisplay('1234.567')).toBe('1,235 L');
    expect(formatLitresDisplay('0.000')).toBe('0 L');
    expect(formatLitresDisplay('9.46')).toBe('9.5 L');
    expect(formatLitresDisplay('9.96')).toBe('10 L');
    expect(formatLitresDisplay('3')).toBe('3 L');
    expect(formatLitresDisplay(undefined)).toBe('—');
  });

  it('turns status codes into sentence case', () => {
    expect(formatStatusSentence('NOT_STARTED')).toBe('Not started');
    expect(formatStatusSentence('APPROVED')).toBe('Approved');
  });

  it('keeps unit prices exact to four places without trailing zeros', () => {
    expect(formatUnitPrice('1.495')).toBe('$1.495');
    expect(formatUnitPrice('1.5')).toBe('$1.50');
    expect(formatUnitPrice('1.23456')).toBe('$1.2346');
    expect(formatUnitPrice('2')).toBe('$2.00');
    expect(formatUnitPrice(null)).toBe('—');
  });
});
