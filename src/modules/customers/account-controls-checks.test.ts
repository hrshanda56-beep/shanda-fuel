import { describe, expect, it } from 'vitest';
import {
  checkDetailsStation,
  checkLimitApprover,
  checkLimitReason,
  checkNewLimit,
  entryDetailsPayload,
  hasAnyDetail,
  parseLimit,
} from './account-controls-checks';

describe('credit limit checks', () => {
  it('reads an exact positive amount', () => {
    expect(parseLimit('2,500.00')).toBe('2500.00');
    expect(parseLimit('0')).toBeNull();
    expect(parseLimit('0.00')).toBeNull();
    expect(parseLimit('abc')).toBeNull();
    expect(parseLimit('1.23456')).toBeNull();
    expect(checkNewLimit('')).toHaveProperty('limit-new');
    expect(checkNewLimit('2500')).toEqual({});
  });

  it('needs an approver and a reason', () => {
    expect(checkLimitApprover('')).toHaveProperty('limit-approver');
    expect(checkLimitApprover('m1')).toEqual({});
    expect(checkLimitReason('  ')).toHaveProperty('limit-reason');
    expect(checkLimitReason('Long-standing customer')).toEqual({});
  });
});

describe('transaction detail checks', () => {
  const none = { vehicle: '', driver: '', voucher: '', approverId: '' };

  it('needs a station and at least one detail', () => {
    expect(checkDetailsStation('')).toHaveProperty('details-station');
    expect(checkDetailsStation('s1')).toEqual({});
    expect(hasAnyDetail(none)).toBe(false);
    expect(hasAnyDetail({ ...none, vehicle: '  ' })).toBe(false);
    expect(hasAnyDetail({ ...none, voucher: 'V-1' })).toBe(true);
    expect(hasAnyDetail({ ...none, approverId: 'm1' })).toBe(true);
  });

  it('sends only the details that were given', () => {
    expect(entryDetailsPayload({ ...none, vehicle: ' ABC 123 ', approverId: 'm1' })).toEqual({
      vehicleRegistration: 'ABC 123',
      approvedByMembershipId: 'm1',
    });
    expect(entryDetailsPayload(none)).toEqual({});
  });
});
