import { describe, expect, it } from 'vitest';

import {
  formatBusinessDate,
  formatDecimal,
  formatLitres,
  formatMoney,
  formatPercentage,
  formatStatusLabel,
} from './formatters';

describe('presentation formatters', () => {
  it('preserves decimal text while adding readable grouping and units', () => {
    expect(formatDecimal('1234567.8900')).toBe('1,234,567.8900');
    expect(formatMoney('12500.00')).toBe('USD 12,500.00');
    expect(formatLitres('1050.375')).toBe('1,050.375 L');
    expect(formatPercentage('4.25')).toBe('4.25%');
  });

  it('rejects malformed authoritative values instead of guessing', () => {
    expect(formatDecimal('not-a-number')).toBe('—');
  });

  it('keeps date-only business dates stable and labels statuses', () => {
    expect(formatBusinessDate('2026-09-20', 'en-GB')).toBe('20 Sept 2026');
    expect(formatBusinessDate('20/09/2026')).toBe('—');
    expect(formatStatusLabel('PENDING_APPROVAL')).toBe('Pending Approval');
  });
});
