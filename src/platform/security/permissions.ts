import { AppError } from '../errors';

export const PERMISSION_CODES = [
  'tenant.view',
  'tenant.manage',
  'legal_entity.view',
  'legal_entity.manage',
  'station.view',
  'station.manage',
  'membership.view',
  'membership.invite',
  'membership.manage',
  'membership.disable',
  'role.view',
  'role.manage',
  'shift.view',
  'shift.start',
  'shift.close',
  'shift.exceptionally_close',
  'shift.mark_not_operated',
  'meter.view',
  'meter.boundary.capture',
  'meter.correction.request',
  'meter.replace',
  'price.view',
  'price.change.request',
  'price.change.approve',
  'price.change.activate',
  'delivery.view',
  'delivery.create',
  'delivery.verify',
  'delivery.offload',
  'delivery.confirm',
  'delivery.post',
  'delivery.reverse',
  'inventory.view',
  'inventory.adjust.request',
  'inventory.adjust.approve',
  'inventory.transfer.dispatch',
  'inventory.transfer.receive',
  'cash.view',
  'cash.count',
  'cash.handover.prepare',
  'cash.handover.confirm',
  'cash.dispute.resolve',
  'cash.collection.create',
  'bank.view',
  'bank.deposit.record',
  'bank.deposit.confirm',
  'bank.account.manage',
  'settlement.view',
  'settlement.batch.record',
  'settlement.match',
  'settlement.confirm',
  'supplier.view',
  'supplier.manage',
  'supplier.invoice.create',
  'supplier.invoice.approve',
  'supplier.payment.create',
  'supplier.payment.approve',
  'supplier.credit_note.create',
  'customer.view',
  'customer.manage',
  'customer.fuel.authorize',
  'customer.limit.override',
  'customer.payment.create',
  'expense.view',
  'expense.create',
  'expense.approve',
  'reconciliation.view',
  'reconciliation.submit',
  'reconciliation.return',
  'reconciliation.approve',
  'reconciliation.post',
  'approval.view',
  'approval.act',
  'exception.view',
  'exception.manage',
  'document.view',
  'document.upload',
  'report.view',
  'report.financial.view',
  'report.export',
  'audit.view',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const ROLE_CODES = ['OWNER', 'ADMINISTRATOR', 'FINANCE', 'SUPERVISOR', 'ATTENDANT'] as const;

export type RoleCode = (typeof ROLE_CODES)[number];
export type ScopeType = 'TENANT' | 'LEGAL_ENTITY' | 'STATION';

export type AccessScope = {
  tenantId: string;
  scopeType: ScopeType;
  legalEntityId?: string;
  stationId?: string;
};

export type RoleAssignment = AccessScope & {
  roleCode: RoleCode;
  expiresAt?: Date;
};

export type TemporaryPermissionGrant = AccessScope & {
  permissionCode: PermissionCode;
  expiresAt: Date;
};

export type AuthorizationActor = {
  userId: string;
  membershipId: string;
  tenantId: string;
  membershipActive: boolean;
  strongAuthenticationAt?: Date;
  strongAuthenticationExpiresAt?: Date;
  stepUpLevel?: 0 | 1 | 2;
  roleAssignments: readonly RoleAssignment[];
  temporaryGrants?: readonly TemporaryPermissionGrant[];
};

const highRiskPermissions = new Set<PermissionCode>([
  'membership.manage',
  'membership.disable',
  'role.manage',
  'price.change.approve',
  'price.change.activate',
  'delivery.post',
  'delivery.reverse',
  'inventory.adjust.approve',
  'bank.account.manage',
  'bank.deposit.confirm',
  'supplier.payment.approve',
  'customer.limit.override',
  'expense.approve',
  'reconciliation.approve',
  'reconciliation.post',
  'approval.act',
  'report.export',
]);

const rolePermissions: Record<RoleCode, readonly PermissionCode[]> = {
  OWNER: PERMISSION_CODES,
  ADMINISTRATOR: [
    'tenant.view',
    'legal_entity.view',
    'legal_entity.manage',
    'station.view',
    'station.manage',
    'membership.view',
    'membership.invite',
    'membership.manage',
    'membership.disable',
    'role.view',
    'role.manage',
    'report.view',
    'report.export',
    'audit.view',
  ],
  FINANCE: [
    'tenant.view',
    'legal_entity.view',
    'station.view',
    'cash.view',
    'cash.collection.create',
    'bank.view',
    'bank.deposit.record',
    'bank.deposit.confirm',
    'settlement.view',
    'settlement.batch.record',
    'settlement.match',
    'settlement.confirm',
    'supplier.view',
    'supplier.invoice.create',
    'supplier.invoice.approve',
    'supplier.payment.create',
    'supplier.payment.approve',
    'supplier.credit_note.create',
    'customer.view',
    'customer.manage',
    'customer.payment.create',
    'expense.view',
    'expense.create',
    'expense.approve',
    'reconciliation.view',
    'reconciliation.approve',
    'reconciliation.post',
    'approval.view',
    'approval.act',
    'exception.view',
    'exception.manage',
    'document.view',
    'document.upload',
    'report.view',
    'report.financial.view',
    'report.export',
    'audit.view',
  ],
  SUPERVISOR: [
    'tenant.view',
    'station.view',
    'shift.view',
    'shift.start',
    'shift.close',
    'shift.exceptionally_close',
    'shift.mark_not_operated',
    'meter.view',
    'meter.boundary.capture',
    'meter.correction.request',
    'meter.replace',
    'price.view',
    'delivery.view',
    'delivery.create',
    'delivery.verify',
    'delivery.offload',
    'delivery.confirm',
    'inventory.view',
    'cash.view',
    'cash.count',
    'cash.handover.prepare',
    'cash.handover.confirm',
    'cash.collection.create',
    'expense.view',
    'expense.create',
    'reconciliation.view',
    'reconciliation.submit',
    'exception.view',
    'exception.manage',
    'document.view',
    'document.upload',
    'report.view',
  ],
  ATTENDANT: [
    'station.view',
    'shift.view',
    'meter.view',
    'cash.view',
    'cash.count',
    'customer.view',
    'customer.fuel.authorize',
    'customer.payment.create',
    'reconciliation.view',
    'reconciliation.submit',
    'document.view',
  ],
};

export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly PermissionCode[]>> =
  rolePermissions;

export function assertValidScope(scope: AccessScope): void {
  if (!scope.tenantId) throw new AppError('FORBIDDEN', 'Tenant scope is required');
  if (scope.scopeType === 'LEGAL_ENTITY' && !scope.legalEntityId) {
    throw new AppError('FORBIDDEN', 'Legal-entity scope is required');
  }
  if (scope.scopeType === 'STATION' && (!scope.legalEntityId || !scope.stationId)) {
    throw new AppError('FORBIDDEN', 'Station scope requires legal-entity and station identifiers');
  }
  if (scope.scopeType !== 'STATION' && scope.stationId) {
    throw new AppError('FORBIDDEN', 'Station scope cannot be attached to this scope type');
  }
}

export function scopeCovers(grant: AccessScope, requested: AccessScope): boolean {
  assertValidScope(grant);
  assertValidScope(requested);
  if (grant.tenantId !== requested.tenantId) return false;
  if (grant.scopeType === 'TENANT') return true;
  if (grant.scopeType === 'LEGAL_ENTITY') {
    return grant.legalEntityId === requested.legalEntityId;
  }
  return grant.stationId === requested.stationId && grant.legalEntityId === requested.legalEntityId;
}

function isActive(expiresAt: Date | undefined, now: Date): boolean {
  return !expiresAt || expiresAt.getTime() > now.getTime();
}

function roleHasPermission(roleCode: RoleCode, permissionCode: PermissionCode): boolean {
  return rolePermissions[roleCode].includes(permissionCode);
}

export function isAuthorized(input: {
  actor: AuthorizationActor;
  permissionCode: PermissionCode;
  requestedScope: AccessScope;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  const { actor, permissionCode, requestedScope } = input;
  if (!actor.membershipActive || actor.tenantId !== requestedScope.tenantId) return false;
  const currentStrongAuthentication =
    actor.strongAuthenticationAt &&
    (!actor.strongAuthenticationExpiresAt || actor.strongAuthenticationExpiresAt > now);
  if (highRiskPermissions.has(permissionCode) && !currentStrongAuthentication) return false;
  const roleGrant = actor.roleAssignments.some(
    (assignment) =>
      isActive(assignment.expiresAt, now) &&
      roleHasPermission(assignment.roleCode, permissionCode) &&
      scopeCovers(assignment, requestedScope),
  );
  const temporaryGrant = actor.temporaryGrants?.some(
    (grant) =>
      isActive(grant.expiresAt, now) &&
      grant.permissionCode === permissionCode &&
      scopeCovers(grant, requestedScope),
  );
  return roleGrant || Boolean(temporaryGrant);
}

export function authorize(input: {
  actor: AuthorizationActor;
  permissionCode: PermissionCode;
  requestedScope: AccessScope;
  now?: Date;
}): void {
  if (!isAuthorized(input)) {
    throw new AppError('FORBIDDEN', 'The actor is not authorized for this action or scope', {
      permissionCode: input.permissionCode,
    });
  }
}
