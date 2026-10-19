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
  const entity = options.find((item) => item.stations.some((station) => station.id === stationId));
  if ('membershipId' in person) {
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
  return (
    (!role || person.role === role) &&
    (!stationId ||
      person.scopeType === 'TENANT' ||
      (person.scopeType === 'LEGAL_ENTITY' && !!entity && person.legalEntityId === entity.id) ||
      (person.scopeType === 'STATION' && person.stationIds.includes(stationId)))
  );
}
