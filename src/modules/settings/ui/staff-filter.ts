import type {
  StaffMemberSummary,
  StaffInvitationSummary,
  StaffScopeOption,
} from '@/modules/staff/contracts';
import type { RoleCode } from '@/modules/authorization';

/** Display filtering only; membership and command authorization remain server-owned. */
export function matchesStaffScope(
  person: StaffMemberSummary | StaffInvitationSummary,
  stationId: string | undefined,
  role: RoleCode | undefined,
  options: readonly StaffScopeOption[],
): boolean {
  if ('membershipId' in person) {
    const entity = options.find((item) =>
      item.stations.some((station) => station.id === stationId),
    );
    if (!stationId) return !role || person.roles.includes(role);
    return (person.assignments ?? []).some(
      (assignment) =>
        (!role || assignment.role === role) &&
        (assignment.scopeType === 'TENANT' ||
          (assignment.scopeType === 'LEGAL_ENTITY' &&
            !!entity &&
            assignment.legalEntityId === entity.id) ||
          (assignment.scopeType === 'STATION' && assignment.stationId === stationId)),
    );
  }
  // Invitations ignore the station picker: a pending invite blocks re-inviting the same
  // email organisation-wide, so hiding it behind another station leaves no way to revoke it.
  return !role || person.role === role;
}
