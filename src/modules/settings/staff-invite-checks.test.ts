import { describe, expect, it } from 'vitest';
import {
  checkInviteEmail,
  checkInviteName,
  checkInviteScope,
  checkInviteStaffNumber,
} from './staff-invite-checks';

describe('staff invite checks', () => {
  it('needs a name', () => {
    expect(checkInviteName('  ')).toHaveProperty('inv-name');
    expect(checkInviteName('Tendai')).toEqual({});
  });

  it('needs a real-looking email address', () => {
    expect(checkInviteEmail('')).toHaveProperty('inv-email');
    expect(checkInviteEmail('tendai@')).toHaveProperty('inv-email');
    expect(checkInviteEmail('tendai@shanda.co.zw')).toEqual({});
  });

  it('lets the staff number be blank, otherwise 4 to 32 safe characters', () => {
    expect(checkInviteStaffNumber('')).toEqual({});
    expect(checkInviteStaffNumber('ab')).toHaveProperty('inv-number');
    expect(checkInviteStaffNumber('has space')).toHaveProperty('inv-number');
    expect(checkInviteStaffNumber('ATT-0042')).toEqual({});
  });

  it('needs a company and at least one station for station access', () => {
    expect(checkInviteScope('TENANT', '', [])).toEqual({});
    expect(checkInviteScope('LEGAL_ENTITY', '', [])).toHaveProperty('inv-company');
    expect(checkInviteScope('LEGAL_ENTITY', 'e1', [])).toEqual({});
    expect(checkInviteScope('STATION', 'e1', [])).toHaveProperty('inv-stations');
    expect(checkInviteScope('STATION', 'e1', ['s1'])).toEqual({});
  });
});
