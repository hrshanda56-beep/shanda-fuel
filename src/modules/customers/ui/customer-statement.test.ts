import { describe, expect, it } from 'vitest';
import {
  customerStatementUrl,
  instantToLocalDateTime,
  localDateTimeToInstant,
} from './customer-statement';

describe('customer statement UI contract', () => {
  it('builds a private statement URL with as-of and cursor filters', () => {
    expect(
      customerStatementUrl({
        tenantId: 'tenant',
        accountId: 'account',
        asOf: '2026-10-17T04:00:00.000Z',
        cursor: 'entry/next',
      }),
    ).toBe(
      '/api/customers/statement?tenantId=tenant&accountId=account&asOf=2026-10-17T04%3A00%3A00.000Z&cursor=entry%2Fnext',
    );
  });

  it('converts the datetime control to an instant and rejects malformed values', () => {
    const instant = localDateTimeToInstant('2026-10-17T06:30');
    expect(instant).toMatch(/^2026-10-17T\d{2}:30:00\.000Z$/);
    expect(localDateTimeToInstant('not-a-date')).toBeUndefined();
    expect(instantToLocalDateTime('not-a-date')).toBe('');
  });
});
