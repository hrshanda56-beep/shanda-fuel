import { describe, expect, it } from 'vitest';
import { describeLockBlockers } from './lock-readiness';

const clear = { draft: 0, submitted: 0, returned: 0, tanksWithoutDip: 0 };

describe('describeLockBlockers', () => {
  it('lets a day lock when every report is approved and every tank was dipped', () => {
    expect(describeLockBlockers(clear)).toBeNull();
  });

  it('names shifts still waiting for approval', () => {
    expect(describeLockBlockers({ ...clear, submitted: 2 })).toBe(
      '2 shifts still waiting for approval.',
    );
    expect(describeLockBlockers({ ...clear, submitted: 1 })).toBe(
      '1 shift still waiting for approval.',
    );
  });

  it('names returned reports and unsubmitted shifts', () => {
    expect(describeLockBlockers({ ...clear, returned: 1 })).toBe(
      '1 report was sent back and has not been resubmitted.',
    );
    expect(describeLockBlockers({ ...clear, draft: 3 })).toBe(
      '3 shift reports are not submitted yet.',
    );
  });

  it('names tanks with no dip reading for the day', () => {
    expect(describeLockBlockers({ ...clear, tanksWithoutDip: 2 })).toBe(
      '2 tanks have no dip reading for this day.',
    );
  });

  it('lists every reason together, so one visit fixes all of them', () => {
    expect(describeLockBlockers({ draft: 0, submitted: 2, returned: 1, tanksWithoutDip: 1 })).toBe(
      '2 shifts still waiting for approval. 1 report was sent back and has not been resubmitted. 1 tank has no dip reading for this day.',
    );
  });
});
