import { describe, expect, it } from 'vitest';
import { matchesStaffScope } from './staff-filter';
import type { StaffMemberSummary, StaffInvitationSummary } from '@/modules/staff/contracts';
const options = [
  {
    id: 'entity',
    name: 'Entity',
    stations: [
      { id: 'a', name: 'A', code: 'A' },
      { id: 'b', name: 'B', code: 'B' },
    ],
  },
];
const member: StaffMemberSummary = {
  membershipId: 'm',
  identityId: 'i',
  name: 'Staff',
  email: null,
  status: 'ACTIVE',
  roles: ['ATTENDANT'],
  scopeLabels: [],
  assignments: [{ role: 'ATTENDANT', scopeType: 'STATION', stationId: 'a' }],
};
const invitation: StaffInvitationSummary = {
  id: 'invite',
  name: 'Invite',
  email: null,
  role: 'FINANCE',
  scopeType: 'LEGAL_ENTITY',
  legalEntityId: 'entity',
  stationIds: [],
  status: 'PENDING',
  createdAt: '',
  deliveryMethod: 'MANUAL',
};
describe('staff display scope', () => {
  it('keeps all staff in all-stations view and combines role filters', () => {
    expect(matchesStaffScope(member, undefined, undefined, options)).toBe(true);
    expect(matchesStaffScope(member, undefined, 'FINANCE', options)).toBe(false);
  });
  it('matches station assignments without parsing labels', () => {
    expect(matchesStaffScope(member, 'a', 'ATTENDANT', options)).toBe(true);
    expect(matchesStaffScope(member, 'b', undefined, options)).toBe(false);
    expect(matchesStaffScope({ ...member, assignments: [] }, 'a', undefined, options)).toBe(false);
  });
  it('matches organisation and legal entity assignments', () => {
    expect(
      matchesStaffScope(
        { ...member, assignments: [{ role: 'OWNER', scopeType: 'TENANT' }] },
        'b',
        'OWNER',
        options,
      ),
    ).toBe(true);
    expect(matchesStaffScope(invitation, 'a', 'FINANCE', options)).toBe(true);
    expect(matchesStaffScope(invitation, 'unknown', undefined, options)).toBe(false);
    expect(
      matchesStaffScope(
        { ...invitation, scopeType: 'STATION', stationIds: ['a'] },
        'b',
        undefined,
        options,
      ),
    ).toBe(false);
  });
});
