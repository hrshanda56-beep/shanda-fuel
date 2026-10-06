import { describe, expect, it } from 'vitest';

import { deriveBusinessDate } from './business-time';

describe('deriveBusinessDate', () => {
  it('uses the station timezone at the instant instead of the process timezone', () => {
    const instant = '2026-10-06T00:30:00.000Z';

    expect(deriveBusinessDate(instant, 'Africa/Harare')).toBe('2026-10-06');
    expect(deriveBusinessDate(instant, 'America/New_York')).toBe('2026-10-05');
  });
});
