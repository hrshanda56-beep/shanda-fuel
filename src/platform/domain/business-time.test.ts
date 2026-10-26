import { describe, expect, it } from 'vitest';

import { stationLocalToInstant } from './business-time';

describe('stationLocalToInstant', () => {
  it('reads a typed time in the station zone, not the browser zone', () => {
    // Harare is UTC+2 all year: 06:00 there is 04:00 UTC.
    expect(stationLocalToInstant('2026-10-27T06:00', 'Africa/Harare')?.toISOString()).toBe(
      '2026-10-27T04:00:00.000Z',
    );
    // New York on 27 Oct 2026 is UTC-4 (daylight time): 06:00 there is 10:00 UTC.
    expect(stationLocalToInstant('2026-10-27T06:00', 'America/New_York')?.toISOString()).toBe(
      '2026-10-27T10:00:00.000Z',
    );
    // After the clocks go back (1 Nov 2026) it is UTC-5.
    expect(stationLocalToInstant('2026-11-02T06:00', 'America/New_York')?.toISOString()).toBe(
      '2026-11-02T11:00:00.000Z',
    );
  });

  it('crosses midnight and date lines correctly', () => {
    expect(stationLocalToInstant('2026-10-27T00:30', 'Africa/Harare')?.toISOString()).toBe(
      '2026-10-26T22:30:00.000Z',
    );
    expect(stationLocalToInstant('2026-10-27T03:00', 'Pacific/Auckland')?.toISOString()).toBe(
      '2026-10-26T14:00:00.000Z',
    );
  });

  it('refuses text that is not a real time', () => {
    expect(stationLocalToInstant('', 'Africa/Harare')).toBeNull();
    expect(stationLocalToInstant('2026-02-30T10:00', 'Africa/Harare')).toBeNull();
    expect(stationLocalToInstant('2026-10-27T25:00', 'Africa/Harare')).toBeNull();
    expect(stationLocalToInstant('27/10/2026 06:00', 'Africa/Harare')).toBeNull();
  });
});
