import type { RoleCode, ScopeType } from '../../platform/security';

/**
 * Where each role can be given access. One table, used by the invite form, the edit-access form
 * and the validator, and mirrored by the database rule `staff_invitations_scope_ck`
 * (migration 0103). A test keeps the table, the validator and the migration in step.
 */
const ROLE_SCOPES: Record<RoleCode, readonly ScopeType[]> = {
  OWNER: ['TENANT'],
  ADMINISTRATOR: ['TENANT'],
  AUDITOR: ['TENANT'],
  FINANCE: ['LEGAL_ENTITY', 'STATION'],
  SUPERVISOR: ['STATION'],
  ATTENDANT: ['STATION'],
  AREA_MANAGER: ['STATION'],
  CASH_COLLECTOR: ['STATION'],
};

export function scopeChoicesForRole(role: RoleCode): readonly ScopeType[] {
  return ROLE_SCOPES[role];
}

export function defaultScopeForRole(role: RoleCode): ScopeType {
  return ROLE_SCOPES[role][0]!;
}
