import { describe, expect, it } from 'vitest';
import { dipInstantForSheet } from './dip-time';

describe('dipInstantForSheet', () => {
  it('uses now while the sheet is for the station’s current day', () => {
    const now = new Date('2026-10-21T10:00:00Z');
    expect(dipInstantForSheet(now, '2026-10-21', 'Africa/Harare')).toBe(now);
  });

  it('uses the last minute of the sheet’s day once the station day has moved on', () => {
    const now = new Date('2026-10-21T23:30:00Z'); // 01:30 on 22/10 in Harare
    const at = dipInstantForSheet(now, '2026-10-21', 'Africa/Harare');
    expect(at.toISOString()).toBe('2026-10-21T21:59:00.000Z');
  });

  it('works west of UTC', () => {
    const now = new Date('2026-10-22T06:00:00Z'); // 22/10 in New York
    const at = dipInstantForSheet(now, '2026-10-21', 'America/New_York');
    expect(at.toISOString()).toBe('2026-10-22T03:59:00.000Z');
  });
});
