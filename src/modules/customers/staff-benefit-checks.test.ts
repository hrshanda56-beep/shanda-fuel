import { describe, expect, it } from 'vitest';
import {
  USUAL_MONTHLY_LIMIT,
  checkMonthlyLimit,
  checkStaffMember,
  cleanLimit,
} from './staff-benefit-checks';

describe('staff benefit checks', () => {
  it('needs a staff member', () => {
    expect(checkStaffMember('')).toHaveProperty('staff-member');
    expect(checkStaffMember('m1')).toEqual({});
  });

  it('needs a limit above zero with at most two decimals', () => {
    expect(checkMonthlyLimit('')).toHaveProperty('staff-limit');
    expect(checkMonthlyLimit('0')).toHaveProperty('staff-limit');
    expect(checkMonthlyLimit('0.00')).toHaveProperty('staff-limit');
    expect(checkMonthlyLimit('abc')).toHaveProperty('staff-limit');
    expect(checkMonthlyLimit('60.555')).toHaveProperty('staff-limit');
    expect(checkMonthlyLimit('60')).toEqual({});
    expect(checkMonthlyLimit('1,060.50')).toEqual({});
    expect(checkMonthlyLimit(USUAL_MONTHLY_LIMIT)).toEqual({});
    expect(cleanLimit(' 1,060.50 ')).toBe('1060.50');
  });
});
