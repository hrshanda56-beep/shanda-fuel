import { AppError } from '../errors';

export const PERMISSION_CODES = [
  'tenant.context.select',
  'tenant.view',
  'tenant.manage',
  'legal_entity.view',
  'legal_entity.manage',
  'station.view',
  'station.manage',
  'membership.view',
  'membership.view.station',
  'membership.invite',
  'membership.manage',
  'membership.disable',
  'role.view',
  'role.manage',
  'document.view',
  'document.upload',
  'report.view',
  'report.finance.view',
  'report.export',
  'audit.view',
  'audit.view.station',
  'business_day.view',
  'business_day.open',
  'business_day.close',
  'business_day.lock',
  'shift.view',
  'shift.start',
  'shift.close',
  'shift.exceptionally_close',
  'shift.mark_not_operated',
  'shift.template.manage',
  'meter.view',
  'meter.boundary.capture',
  'meter.reset',
  'meter.correction.request',
  'meter.correction.execute',
  'meter.replace',
  'price.view',
  'price.change.request',
  'price.change.approve',
  'price.change.prepare',
  'price.change.activate',
  'price.change.boundary',
  'reconciliation.view',
  'reconciliation.submit',
  'reconciliation.return',
  'reconciliation.approve',
  'reconciliation.post',
  'approval.view',
  'approval.act',
  'exception.view',
  'exception.manage',
  'inventory.view',
  'inventory.tank.manage',
  'inventory.dip.record',
  'inventory.delivery.manage',
  'inventory.adjustment.post',
  'finance.opening_balance.manage',
  'cash.collection.view',
  'cash.collection.record',
  'cash.collection.receive',
  'cash.location.manage',
  'cash.count.record',
  'cash.handover.submit',
  'cash.handover.accept',
  'cash.handover.resolve',
  'cash.deposit.record',
  'cash.deposit.confirm',
  'cash.deposit.view',
  'provider.batch.record',
  'provider.settlement.post',
  'provider.view',
  'provider.manage',
  'provider.settlement.view',
  'provider.settlement.record',
  'provider.settlement.allocate',
  'provider.settlement.reconcile',
  'provider.settlement.reverse',
  'supplier.view',
  'supplier.manage',
  'supplier.document.create',
  'supplier.document.post',
  'supplier.document.reverse',
  'supplier.payment.create',
  'supplier.payment.post',
  'supplier.payment.allocate',
  'supplier.payment.reverse',
  'supplier.creditor.review',
  'supplier.delivery.link',
  'purchasing.policy.manage',
  'customer.view',
  'customer.manage',
  'customer.account.manage',
  'customer.credit.authorize',
  'customer.prepaid.top_up',
  'customer.payment.record',
  'customer.statement.view',
  'customer.account.adjust',
  'customer.limit.override',
  'expense.view',
  'expense.submit',
  'expense.approve',
  'expense.approve.any_amount',
  'expense.post',
  'expense.reverse',
  'expense.payment.record',
  'expense.payment.reverse',
  'expense.manage',
  'expense.policy.manage',
  'expense.recurring.manage',
  'expense.recurring.recognize',
  'purchase_order.view',
  'purchase_order.create',
  'purchase_order.approve',
  'purchase_order.cancel',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export const ROLE_CODES = [
  'OWNER',
  'ADMINISTRATOR',
  'FINANCE',
  'SUPERVISOR',
  'ATTENDANT',
  'AUDITOR',
  'AREA_MANAGER',
  'CASH_COLLECTOR',
] as const;

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
  revokedAt?: Date;
};

export type AuthorizationActor = {
  userId: string;
  membershipId: string;
  tenantId: string;
  membershipActive: boolean;
  strongAuthenticationAt?: Date;
  strongAuthenticationExpiresAt?: Date;
  strongAuthenticationVerified?: boolean;
  stepUpLevel?: 0 | 1 | 2;
  stepUpTenantId?: string;
  roleAssignments: readonly RoleAssignment[];
  temporaryGrants?: readonly TemporaryPermissionGrant[];
};

const highRiskPermissions = new Set<PermissionCode>([
  'tenant.manage',
  'legal_entity.manage',
  'station.manage',
  'membership.manage',
  'membership.disable',
  'role.manage',
  'report.export',
  'price.change.approve',
  'price.change.prepare',
  'price.change.activate',
  'reconciliation.approve',
  'reconciliation.post',
  'approval.act',
  'business_day.lock',
  'meter.reset',
  'meter.correction.execute',
  'meter.replace',
  'price.change.boundary',
  'shift.template.manage',
  'inventory.tank.manage',
  'inventory.delivery.manage',
  'inventory.adjustment.post',
  'finance.opening_balance.manage',
  'cash.location.manage',
  'cash.handover.accept',
  'cash.handover.resolve',
  'cash.deposit.confirm',
  'provider.settlement.post',
  'provider.manage',
  'provider.settlement.reconcile',
  'provider.settlement.reverse',
  'supplier.document.post',
  'supplier.document.reverse',
  'supplier.payment.post',
  'supplier.payment.reverse',
  'purchasing.policy.manage',
  'customer.account.manage',
  'customer.credit.authorize',
  'customer.prepaid.top_up',
  'customer.account.adjust',
  'customer.limit.override',
  'expense.reverse',
  'expense.payment.reverse',
  'expense.policy.manage',
]);

type OriginalRole = 'OWNER' | 'ADMINISTRATOR' | 'FINANCE' | 'SUPERVISOR' | 'ATTENDANT';

const originalRolePermissions: Record<OriginalRole, readonly PermissionCode[]> = {
  OWNER: PERMISSION_CODES,
  ADMINISTRATOR: [
    'tenant.context.select',
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
    'document.view',
    'document.upload',
    'report.view',
    'report.finance.view',
    'report.export',
    'audit.view',
    'business_day.view',
    'business_day.open',
    'business_day.close',
    'business_day.lock',
    'shift.view',
    'shift.start',
    'shift.close',
    'shift.exceptionally_close',
    'shift.mark_not_operated',
    'shift.template.manage',
    'meter.view',
    'meter.boundary.capture',
    'meter.reset',
    'meter.correction.request',
    'meter.correction.execute',
    'meter.replace',
    'price.view',
    'price.change.boundary',
    'price.change.request',
    'price.change.approve',
    'price.change.prepare',
    'price.change.activate',
    'reconciliation.view',
    'reconciliation.submit',
    'reconciliation.return',
    'reconciliation.approve',
    'reconciliation.post',
    'approval.view',
    'approval.act',
    'exception.view',
    'exception.manage',
    'inventory.view',
    'finance.opening_balance.manage',
    'inventory.tank.manage',
    'inventory.dip.record',
    'inventory.delivery.manage',
    'inventory.adjustment.post',
    'cash.collection.view',
    'cash.collection.record',
    'cash.collection.receive',
    'cash.location.manage',
    'cash.count.record',
    'cash.handover.submit',
    'cash.handover.accept',
    'cash.handover.resolve',
    'cash.deposit.record',
    'cash.deposit.confirm',
    'cash.deposit.view',
    'provider.batch.record',
    'provider.settlement.post',
    'provider.view',
    'provider.manage',
    'provider.settlement.view',
    'provider.settlement.record',
    'provider.settlement.allocate',
    'provider.settlement.reconcile',
    'provider.settlement.reverse',
    'supplier.view',
    'supplier.manage',
    'supplier.document.create',
    'supplier.document.post',
    'supplier.document.reverse',
    'supplier.payment.create',
    'supplier.payment.post',
    'supplier.payment.allocate',
    'supplier.payment.reverse',
    'supplier.creditor.review',
    'supplier.delivery.link',
    'purchasing.policy.manage',
    'customer.view',
    'customer.manage',
    'customer.account.manage',
    'customer.credit.authorize',
    'customer.prepaid.top_up',
    'customer.payment.record',
    'customer.statement.view',
    'customer.account.adjust',
    'customer.limit.override',
    'expense.view',
    'expense.submit',
    'expense.approve',
    'expense.approve.any_amount',
    'expense.post',
    'expense.reverse',
    'expense.payment.record',
    'expense.payment.reverse',
    'expense.manage',
    'expense.policy.manage',
    'expense.recurring.manage',
    'expense.recurring.recognize',
    'purchase_order.view',
    'purchase_order.create',
    'purchase_order.approve',
    'purchase_order.cancel',
  ],
  FINANCE: [
    'tenant.context.select',
    'tenant.view',
    'legal_entity.view',
    'station.view',
    'document.view',
    'document.upload',
    'report.view',
    'report.finance.view',
    'report.export',
    'audit.view',
    'business_day.view',
    'shift.view',
    'meter.view',
    'price.view',
    'reconciliation.view',
    'reconciliation.approve',
    'reconciliation.return',
    'reconciliation.post',
    'approval.view',
    'approval.act',
    'business_day.lock',
    'exception.view',
    'exception.manage',
    'inventory.view',
    'finance.opening_balance.manage',
    'cash.collection.view',
    'cash.collection.record',
    'cash.collection.receive',
    'cash.location.manage',
    'cash.count.record',
    'cash.handover.submit',
    'cash.handover.accept',
    'cash.handover.resolve',
    'cash.deposit.record',
    'cash.deposit.confirm',
    'cash.deposit.view',
    'provider.batch.record',
    'provider.settlement.post',
    'provider.view',
    'provider.settlement.view',
    'provider.settlement.record',
    'provider.settlement.allocate',
    'provider.settlement.reconcile',
    'provider.settlement.reverse',
    'supplier.view',
    'supplier.manage',
    'supplier.document.create',
    'supplier.document.post',
    'supplier.document.reverse',
    'supplier.payment.create',
    'supplier.payment.post',
    'supplier.payment.allocate',
    'supplier.payment.reverse',
    'supplier.creditor.review',
    'supplier.delivery.link',
    'customer.view',
    'customer.credit.authorize',
    'customer.prepaid.top_up',
    'customer.payment.record',
    'customer.statement.view',
    'expense.view',
    'expense.submit',
    'expense.approve',
    'expense.approve.any_amount',
    'expense.post',
    'expense.reverse',
    'expense.payment.record',
    'expense.payment.reverse',
    'expense.manage',
    'expense.recurring.manage',
    'expense.recurring.recognize',
    'purchase_order.view',
    'purchase_order.create',
    'purchase_order.approve',
    'purchase_order.cancel',
  ],
  SUPERVISOR: [
    'tenant.context.select',
    'tenant.view',
    'station.view',
    'document.view',
    'document.upload',
    'report.view',
    'audit.view.station',
    'membership.view.station',
    'business_day.view',
    'business_day.open',
    'business_day.close',
    'shift.view',
    'shift.start',
    'shift.close',
    'shift.exceptionally_close',
    'shift.mark_not_operated',
    'meter.view',
    'meter.boundary.capture',
    'meter.reset',
    'meter.correction.request',
    'meter.correction.execute',
    'meter.replace',
    'price.view',
    'price.change.boundary',
    'price.change.prepare',
    'reconciliation.view',
    'reconciliation.submit',
    'reconciliation.approve',
    'approval.view',
    'exception.view',
    'exception.manage',
    'inventory.view',
    'inventory.dip.record',
    'inventory.delivery.manage',
    'cash.collection.view',
    'cash.collection.record',
    'cash.count.record',
    'cash.handover.submit',
    'provider.batch.record',
    'provider.view',
    'provider.settlement.view',
    'provider.settlement.record',
    'customer.view',
    'customer.credit.authorize',
    'customer.statement.view',
    'expense.view',
    'expense.submit',
    'expense.approve',
    'purchase_order.view',
    'purchase_order.create',
  ],
  ATTENDANT: [
    'tenant.context.select',
    'station.view',
    'shift.view',
    'meter.view',
    'meter.boundary.capture',
  ],
};

/**
 * The extra roles (D2). Each is a set of existing permissions, written the same way in migration
 * 0094 and compared with the database in an integration test.
 * - AUDITOR: every view permission and nothing that acts, so it can read everything and change
 *   nothing (no export, no approval, no recording).
 * - AREA_MANAGER: the supervisor's permissions plus the finance reports, over the several
 *   stations it is assigned (which stations comes from the assignments, as for a supervisor).
 * - CASH_COLLECTOR: receives collections and accepts or submits handovers, and sees deposits.
 */
const rolePermissions: Record<RoleCode, readonly PermissionCode[]> = {
  ...originalRolePermissions,
  AUDITOR: PERMISSION_CODES.filter(
    (code) => code === 'tenant.context.select' || /\.view(\.|$)/.test(code),
  ),
  AREA_MANAGER: [...originalRolePermissions.SUPERVISOR, 'report.finance.view'],
  CASH_COLLECTOR: [
    'tenant.context.select',
    'station.view',
    'cash.collection.view',
    'cash.collection.receive',
    'cash.handover.submit',
    'cash.handover.accept',
    'cash.deposit.view',
  ],
};

export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly PermissionCode[]>> =
  rolePermissions;

export function assertValidScope(scope: AccessScope): void {
  if (!scope.tenantId) throw new AppError('FORBIDDEN', 'Tenant scope is required');
  if (scope.scopeType === 'TENANT' && (scope.legalEntityId || scope.stationId)) {
    throw new AppError('FORBIDDEN', 'Tenant scope cannot include narrower identifiers');
  }
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

function isActive(expiresAt: Date | undefined, now: Date, revokedAt?: Date): boolean {
  return !revokedAt && (!expiresAt || expiresAt.getTime() > now.getTime());
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
  if (!isPermissionGranted(input)) return false;
  const currentStrongAuthentication =
    actor.strongAuthenticationVerified === true &&
    actor.strongAuthenticationAt &&
    (!actor.strongAuthenticationExpiresAt || actor.strongAuthenticationExpiresAt > now);
  if (
    highRiskPermissions.has(permissionCode) &&
    (!currentStrongAuthentication || actor.stepUpTenantId !== requestedScope.tenantId)
  ) {
    return false;
  }

  return true;
}

export function isPermissionGranted(input: {
  actor: AuthorizationActor;
  permissionCode: PermissionCode;
  requestedScope: AccessScope;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  const { actor, permissionCode, requestedScope } = input;
  if (!actor.membershipActive || actor.tenantId !== requestedScope.tenantId) return false;
  const roleGrant = actor.roleAssignments.some(
    (assignment) =>
      isActive(assignment.expiresAt, now) &&
      roleHasPermission(assignment.roleCode, permissionCode) &&
      scopeCovers(assignment, requestedScope),
  );
  const temporaryGrant = actor.temporaryGrants?.some(
    (grant) =>
      isActive(grant.expiresAt, now, grant.revokedAt) &&
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
    // The role allows it; only the recent identity check is missing. Say so, so the screen can ask
    // for the check instead of reporting a refusal that is not true.
    if (highRiskPermissions.has(input.permissionCode) && isPermissionGranted(input)) {
      throw new AppError(
        'STEP_UP_REQUIRED',
        'Please confirm it is you (step-up check) to do this. Nothing was changed.',
        { permissionCode: input.permissionCode, stepUpRequired: true },
      );
    }
    throw new AppError('FORBIDDEN', 'The actor is not authorized for this action or scope', {
      permissionCode: input.permissionCode,
    });
  }
}

export type RoleMutation = {
  actorMembershipId: string;
  targetMembershipId: string;
  targetRoleCode: RoleCode;
  operation: 'GRANT' | 'REVOKE';
  targetCurrentlyOwner: boolean;
  activeOwnerCount: number;
  ownershipTransferConfirmed?: boolean;
};

/** Guardrails for named membership/ownership commands; no owner bypass exists. */
export function assertRoleMutationAllowed(mutation: RoleMutation): void {
  if (mutation.actorMembershipId === mutation.targetMembershipId) {
    throw new AppError(
      'FORBIDDEN',
      'A membership cannot elevate or mutate its own role assignment',
    );
  }
  if (
    mutation.operation === 'REVOKE' &&
    mutation.targetCurrentlyOwner &&
    mutation.activeOwnerCount <= 1
  ) {
    throw new AppError('INVARIANT_VIOLATION', 'The last active owner cannot be removed');
  }
  if (
    mutation.operation === 'GRANT' &&
    mutation.targetRoleCode === 'OWNER' &&
    !mutation.ownershipTransferConfirmed
  ) {
    throw new AppError(
      'FORBIDDEN',
      'Owner assignment requires an explicit ownership transfer command',
    );
  }
}
