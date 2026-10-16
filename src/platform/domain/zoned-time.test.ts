import { describe, expect, it } from 'vitest';
import { isValidIanaTimeZone, stationLocalDateTimeToIso } from './zoned-time';

describe('stationLocalDateTimeToIso', () => {
  it('uses the station timezone instead of the browser or Node timezone', () => {
    expect(stationLocalDateTimeToIso('2026-10-16T06:30', 'Africa/Harare')).toBe(
      '2026-10-16T04:30:00.000Z',
    );
    expect(stationLocalDateTimeToIso('2026-10-16T06:30', 'Asia/Kolkata')).toBe(
      '2026-10-16T01:00:00.000Z',
    );
  });

  it('rejects incomplete local input and invalid timezones', () => {
    expect(() => stationLocalDateTimeToIso('2026-10-16', 'Africa/Harare')).toThrow();
    expect(() => stationLocalDateTimeToIso('2026-02-30T06:30', 'Africa/Harare')).toThrow();
    expect(() => stationLocalDateTimeToIso('2026-10-16T06:30', 'not/a-timezone')).toThrow();
    expect(isValidIanaTimeZone('not/a-timezone')).toBe(false);
    expect(isValidIanaTimeZone('Africa/Harare')).toBe(true);
  });
});
