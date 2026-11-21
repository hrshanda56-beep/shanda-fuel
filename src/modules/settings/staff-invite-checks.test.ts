import { describe, expect, it } from 'vitest';
import {
  checkInviteEmail,
  checkInviteName,
  checkInviteScope,
  checkInviteStaffNumber,
  staffInvitationCommand,
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

describe('staffInvitationCommand', () => {
  const base = {
    name: 'Tendai',
    deliveryMethod: 'MANUAL' as const,
    email: '',
    staffNumber: 'TEN001',
    role: 'ATTENDANT',
    scopeType: 'STATION' as const,
    legalEntityId: 'le1',
    stationIds: ['s1'],
  };

  it('builds a staff-number invitation for one station', () => {
    expect(staffInvitationCommand(base)).toEqual({
      commandType: 'CreateStaffInvitation',
      invitedName: 'Tendai',
      deliveryMethod: 'MANUAL',
      staffNumber: 'TEN001',
      assignedRole: 'ATTENDANT',
      scopeType: 'STATION',
      legalEntityId: 'le1',
      stationIds: ['s1'],
    });
  });

  it('builds an email invitation and leaves out an empty company', () => {
    expect(
      staffInvitationCommand({
        ...base,
        deliveryMethod: 'EMAIL',
        email: 'a@b.co',
        scopeType: 'TENANT',
        legalEntityId: '',
        stationIds: [],
      }),
    ).toEqual({
      commandType: 'CreateStaffInvitation',
      invitedName: 'Tendai',
      invitedEmail: 'a@b.co',
      deliveryMethod: 'EMAIL',
      assignedRole: 'ATTENDANT',
      scopeType: 'TENANT',
      stationIds: [],
    });
  });
});
