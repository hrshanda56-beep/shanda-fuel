import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { describeMissingDips } from './closing-shift-dips';

describe('describeMissingDips', () => {
  it('names one tank and says where to fix it', () => {
    expect(describeMissingDips(['T1'])).toBe(
      'Tank T1 has no dip reading for this shift. Record a dip for it on the Tank dips step, then submit.',
    );
  });

  it('names several tanks together', () => {
    expect(describeMissingDips(['T1', 'T2'])).toBe(
      'Tanks T1, T2 have no dip reading for this shift. Record a dip for each on the Tank dips step, then submit.',
    );
  });
});
