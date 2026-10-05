import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import type { Sql, TransactionSql } from 'postgres';

import {
  signSecurityEvent,
  type SignedSecurityEvent,
} from '../src/platform/security/audit-signing';

/**
 * Operator-only local tool. This file is deliberately outside `src/app` and
 * is not imported by the application runtime.
 */
export const TOOL_NAME = 'first-production-user-provisioning';
export const PROVISIONING_REASON = TOOL_NAME;
export const ACCEPTED_PROVISIONING_DB_ROLE = 'first_user_provisioner';
export const MAX_GRANT_TTL_MS = 2 * 60 * 60 * 1000;
export const CREDENTIAL_PROVIDER_ID = 'credential';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 12;

export type ReadOnlyGrantScope = 'TENANT' | 'LEGAL_ENTITY' | 'STATION';

export type ReadOnlyGrantPlan = Readonly<{
  permissionCode: string;
  scopeType: ReadOnlyGrantScope;
}>;

/**
 * These are the only permissions this tool can create. They are deliberately
 * explicit rather than derived from a role so a role change cannot broaden
 * the first account's access.
 */
export const READ_ONLY_GRANT_PLAN = [
  { permissionCode: 'tenant.context.select', scopeType: 'TENANT' },
  { permissionCode: 'tenant.view', scopeType: 'TENANT' },
  { permissionCode: 'legal_entity.view', scopeType: 'LEGAL_ENTITY' },
  { permissionCode: 'station.view', scopeType: 'STATION' },
  { permissionCode: 'business_day.view', scopeType: 'STATION' },
  { permissionCode: 'shift.view', scopeType: 'STATION' },
  { permissionCode: 'supplier.view', scopeType: 'LEGAL_ENTITY' },
  { permissionCode: 'supplier.creditor.review', scopeType: 'LEGAL_ENTITY' },
  { permissionCode: 'inventory.view', scopeType: 'STATION' },
  { permissionCode: 'provider.settlement.view', scopeType: 'STATION' },
  { permissionCode: 'cash.collection.view', scopeType: 'STATION' },
  { permissionCode: 'cash.deposit.view', scopeType: 'STATION' },
] as const satisfies readonly ReadOnlyGrantPlan[];

export type ScopeIds = Readonly<{
  tenantId: string;
  legalEntityId: string;
  stationId: string;
}>;

export type ScopeSnapshot = Readonly<{
  tenant: { id: string; name: string; status: string };
  legalEntity: { id: string; tenantId: string; name: string; status: string };
  station: {
    id: string;
    tenantId: string;
    legalEntityId: string;
    code: string;
    name: string;
    status: string;
  };
}>;

export type IdentitySnapshot = Readonly<{
  id: string;
  name: string;
  email: string;
  accounts: readonly {
    id: string;
    accountId: string;
    providerId: string;
    userId: string;
    hasPassword: boolean;
  }[];
  memberships: readonly {
    id: string;
    tenantId: string;
    identityId: string;
    status: string;
    roleAssignmentCount: number;
  }[];
}>;

export type ProvisioningInput = Readonly<{
  email: string;
  displayName: string;
  scope: ScopeIds;
  expiresAt: Date;
  lockScope?: boolean;
}>;

export type ProvisioningPlan = Readonly<{
  now: Date;
  expiresAt: Date;
  operationId: string;
  userId: string;
  membershipId: string;
  scope: ScopeSnapshot;
  grants: readonly ReadOnlyGrantPlan[];
}>;

export type ProvisioningResult = Readonly<{
  operationId: string;
  userId: string;
  membershipId: string;
  expiresAt: Date;
  permissionCodes: readonly string[];
  auditEventIds: readonly string[];
}>;

export type RevokeResult = Readonly<{
  operationId: string;
  userId: string;
  membershipId: string;
  revokedGrantCount: number;
  revokedSessionCount: number;
  membershipDisabled: boolean;
  auditEventId?: string;
}>;

export type ProvisioningRepository = Readonly<{
  now: () => Promise<Date>;
  lockEmail: (email: string) => Promise<void>;
  loadScope: (scope: ScopeIds, options?: { lock?: boolean }) => Promise<ScopeSnapshot>;
  findIdentityByEmail: (email: string, tenantId?: string) => Promise<IdentitySnapshot | null>;
  listPermissionDefinitions: () => Promise<readonly string[]>;
  setTenantContext: (scope: ScopeIds & { actorId: string; membershipId: string }) => Promise<void>;
  insertUser: (input: { id: string; name: string; email: string }) => Promise<void>;
  insertCredentialAccount: (input: {
    userId: string;
    accountId: string;
    providerId: string;
    passwordHash: string;
  }) => Promise<void>;
  insertMembership: (input: { id: string; tenantId: string; identityId: string }) => Promise<void>;
  insertGrant: (input: {
    tenantId: string;
    membershipId: string;
    permissionCode: string;
    scopeType: ReadOnlyGrantScope;
    legalEntityId?: string;
    stationId?: string;
    expiresAt: Date;
    reason: string;
  }) => Promise<void>;
  appendAuditEvent: (event: SignedSecurityEvent) => Promise<void>;
  listUnrevokedTemporaryGrants: (input: {
    tenantId: string;
    membershipId: string;
    operationId: string;
  }) => Promise<readonly TemporaryGrantSnapshot[]>;
  revokeTemporaryGrants: (input: {
    tenantId: string;
    membershipId: string;
    grantIds: readonly string[];
    reason: string;
  }) => Promise<number>;
  revokeSessions: (userId: string) => Promise<number>;
  disableMembership: (input: {
    tenantId: string;
    membershipId: string;
    identityId: string;
  }) => Promise<boolean>;
  provisionAtomic?: (input: {
    userId: string;
    membershipId: string;
    operationId: string;
    tenantId: string;
    legalEntityId: string;
    stationId: string;
    email: string;
    displayName: string;
    passwordHash: string;
    expiresAt: Date;
    initiatedEvent: SignedSecurityEvent;
    completedEvent: SignedSecurityEvent;
  }) => Promise<void>;
  revokeAtomic?: (input: {
    userId: string;
    membershipId: string;
    operationId: string;
    tenantId: string;
    legalEntityId: string;
    stationId: string;
    event: SignedSecurityEvent;
  }) => Promise<{
    revokedGrantCount: number;
    revokedSessionCount: number;
    membershipDisabled: boolean;
  }>;
}>;

export type TemporaryGrantSnapshot = Readonly<{
  id: string;
  tenantId: string;
  membershipId: string;
  permissionCode: string;
  scopeType: ReadOnlyGrantScope;
  legalEntityId: string | null;
  stationId: string | null;
  reason: string;
}>;

export class ProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisioningError';
  }
}

export class DuplicateProvisioningError extends ProvisioningError {}
export class ScopeValidationError extends ProvisioningError {}

async function defaultPasswordHasher(password: string): Promise<string> {
  const { hashPassword } = await import('better-auth/crypto');
  return hashPassword(password);
}

function assertUuid(name: string, value: string): void {
  if (!UUID_PATTERN.test(value)) throw new ScopeValidationError(`${name} must be a UUID`);
}

export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new ProvisioningError('A valid operator email is required');
  }
  return email;
}

export function validateDisplayName(input: string): string {
  const displayName = input.trim();
  if (displayName.length < 1 || displayName.length > 160) {
    throw new ProvisioningError('Display name must contain 1 to 160 characters');
  }
  return displayName;
}

export function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new ProvisioningError(`Password must contain at least ${PASSWORD_MIN_LENGTH} characters`);
  }
}

export function validateExpiry(expiresAt: Date, now: Date): Date {
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new ProvisioningError('Grant expiry must be a valid timestamp');
  }
  if (expiresAt.getTime() <= now.getTime()) {
    throw new ProvisioningError('Grant expiry must be in the future');
  }
  if (expiresAt.getTime() > now.getTime() + MAX_GRANT_TTL_MS) {
    throw new ProvisioningError('Grant expiry cannot be more than two hours from database time');
  }
  return expiresAt;
}

export function scopeForGrant(
  grant: ReadOnlyGrantPlan,
  scope: ScopeIds,
): { scopeType: ReadOnlyGrantScope; legalEntityId?: string; stationId?: string } {
  if (grant.scopeType === 'TENANT') return { scopeType: 'TENANT' };
  if (grant.scopeType === 'LEGAL_ENTITY') {
    return { scopeType: 'LEGAL_ENTITY', legalEntityId: scope.legalEntityId };
  }
  return {
    scopeType: 'STATION',
    legalEntityId: scope.legalEntityId,
    stationId: scope.stationId,
  };
}

export function provisioningReason(operationId: string): string {
  return `${PROVISIONING_REASON}:${operationId}`;
}

function assertActiveScope(scope: ScopeSnapshot, ids: ScopeIds): void {
  assertUuid('tenant ID', ids.tenantId);
  assertUuid('legal-entity ID', ids.legalEntityId);
  assertUuid('station ID', ids.stationId);

  if (scope.tenant.id !== ids.tenantId || scope.tenant.status !== 'ACTIVE') {
    throw new ScopeValidationError('The selected tenant is missing or inactive');
  }
  if (
    scope.legalEntity.id !== ids.legalEntityId ||
    scope.legalEntity.tenantId !== ids.tenantId ||
    scope.legalEntity.status !== 'ACTIVE'
  ) {
    throw new ScopeValidationError(
      'The selected legal entity is outside the selected tenant or inactive',
    );
  }
  if (
    scope.station.id !== ids.stationId ||
    scope.station.tenantId !== ids.tenantId ||
    scope.station.legalEntityId !== ids.legalEntityId ||
    scope.station.status !== 'ACTIVE'
  ) {
    throw new ScopeValidationError(
      'The selected station is outside the selected legal entity or inactive',
    );
  }
}

function assertRequiredPermissions(
  available: readonly string[],
  required: readonly ReadOnlyGrantPlan[],
): void {
  const availableSet = new Set(available);
  const missing = required
    .map((grant) => grant.permissionCode)
    .filter((permissionCode) => !availableSet.has(permissionCode));
  if (missing.length > 0) {
    throw new ProvisioningError(
      `Required permission definitions are missing: ${missing.join(', ')}`,
    );
  }
}

export async function preparePlan(
  repository: ProvisioningRepository,
  input: ProvisioningInput,
): Promise<ProvisioningPlan> {
  const email = normalizeEmail(input.email);
  const displayName = validateDisplayName(input.displayName);
  if (!displayName) throw new ProvisioningError('Display name is required');
  await repository.lockEmail(email);
  const now = await repository.now();
  const expiresAt = validateExpiry(input.expiresAt, now);
  const scope = await repository.loadScope(input.scope, { lock: input.lockScope !== false });
  assertActiveScope(scope, input.scope);
  const existing = await repository.findIdentityByEmail(email, input.scope.tenantId);
  if (existing) {
    throw new DuplicateProvisioningError(
      'An identity already exists for this email; duplicate provisioning is refused',
    );
  }
  const availablePermissions = await repository.listPermissionDefinitions();
  assertRequiredPermissions(availablePermissions, READ_ONLY_GRANT_PLAN);

  return {
    now,
    expiresAt,
    operationId: randomUUID(),
    userId: randomUUID(),
    membershipId: randomUUID(),
    scope,
    grants: READ_ONLY_GRANT_PLAN,
  };
}

function auditEvent(input: {
  actionCode: string;
  plan: ProvisioningPlan;
  actorId?: string;
  subjectId: string;
  membershipId: string;
  key: { keyId: string; secret: string };
  metadata: Record<string, unknown>;
}): SignedSecurityEvent {
  return signSecurityEvent(
    {
      eventId: randomUUID(),
      tenantId: input.plan.scope.tenant.id,
      membershipId: input.membershipId,
      actorId: input.actorId,
      eventCode: input.actionCode,
      requestId: randomUUID(),
      occurredAt: input.plan.now.toISOString(),
      details: {
        actorType: 'SUPPORT',
        initiatedBy: TOOL_NAME,
        subjectType: 'auth.user',
        subjectId: input.subjectId,
        metadata: {
          legalEntityId: input.plan.scope.legalEntity.id,
          stationId: input.plan.scope.station.id,
          membershipId: input.membershipId,
          operationId: input.plan.operationId,
          ...input.metadata,
        },
      },
    },
    input.key,
  );
}

export async function provisionFirstUser(input: {
  repository: ProvisioningRepository;
  request: ProvisioningInput;
  password: string;
  auditKey: { keyId: string; secret: string };
  hasher?: (password: string) => Promise<string>;
}): Promise<ProvisioningResult> {
  validatePassword(input.password);
  const email = normalizeEmail(input.request.email);
  const displayName = validateDisplayName(input.request.displayName);
  const plan = await preparePlan(input.repository, { ...input.request, email, displayName });
  const passwordHash = await (input.hasher ?? defaultPasswordHasher)(input.password);
  if (!passwordHash || passwordHash === input.password) {
    throw new ProvisioningError('Better Auth did not return a valid password hash');
  }

  if (input.repository.provisionAtomic) {
    const initiated = auditEvent({
      actionCode: 'ACCESS.PROVISIONING_INITIATED',
      plan,
      subjectId: plan.userId,
      membershipId: plan.membershipId,
      key: input.auditKey,
      metadata: {
        permissionCodes: plan.grants.map((grant) => grant.permissionCode),
        expiresAt: plan.expiresAt.toISOString(),
        outcome: 'initiated',
      },
    });
    const completed = auditEvent({
      actionCode: 'ACCESS.PROVISIONING_COMPLETED',
      plan,
      subjectId: plan.userId,
      membershipId: plan.membershipId,
      key: input.auditKey,
      metadata: {
        permissionCodes: plan.grants.map((grant) => grant.permissionCode),
        expiresAt: plan.expiresAt.toISOString(),
        outcome: 'success',
      },
    });
    await input.repository.provisionAtomic({
      userId: plan.userId,
      membershipId: plan.membershipId,
      operationId: plan.operationId,
      tenantId: plan.scope.tenant.id,
      legalEntityId: plan.scope.legalEntity.id,
      stationId: plan.scope.station.id,
      email,
      displayName,
      passwordHash,
      expiresAt: plan.expiresAt,
      initiatedEvent: initiated,
      completedEvent: completed,
    });
    return {
      operationId: plan.operationId,
      userId: plan.userId,
      membershipId: plan.membershipId,
      expiresAt: plan.expiresAt,
      permissionCodes: plan.grants.map((grant) => grant.permissionCode),
      auditEventIds: [initiated.eventId, completed.eventId],
    };
  }

  await input.repository.insertUser({ id: plan.userId, name: displayName, email });
  await input.repository.insertCredentialAccount({
    userId: plan.userId,
    accountId: plan.userId,
    providerId: CREDENTIAL_PROVIDER_ID,
    passwordHash,
  });
  await input.repository.insertMembership({
    id: plan.membershipId,
    tenantId: plan.scope.tenant.id,
    identityId: plan.userId,
  });
  await input.repository.setTenantContext({
    tenantId: plan.scope.tenant.id,
    legalEntityId: plan.scope.legalEntity.id,
    stationId: plan.scope.station.id,
    actorId: plan.userId,
    membershipId: plan.membershipId,
  });

  const initiated = auditEvent({
    actionCode: 'ACCESS.PROVISIONING_INITIATED',
    plan,
    subjectId: plan.userId,
    membershipId: plan.membershipId,
    key: input.auditKey,
    metadata: {
      permissionCodes: plan.grants.map((grant) => grant.permissionCode),
      expiresAt: plan.expiresAt.toISOString(),
      outcome: 'initiated',
    },
  });
  await input.repository.appendAuditEvent(initiated);

  for (const grant of plan.grants) {
    const scope = scopeForGrant(grant, {
      tenantId: plan.scope.tenant.id,
      legalEntityId: plan.scope.legalEntity.id,
      stationId: plan.scope.station.id,
    });
    await input.repository.insertGrant({
      tenantId: plan.scope.tenant.id,
      membershipId: plan.membershipId,
      permissionCode: grant.permissionCode,
      ...scope,
      expiresAt: plan.expiresAt,
      reason: provisioningReason(plan.operationId),
    });
  }

  const completed = auditEvent({
    actionCode: 'ACCESS.PROVISIONING_COMPLETED',
    plan,
    subjectId: plan.userId,
    membershipId: plan.membershipId,
    key: input.auditKey,
    metadata: {
      permissionCodes: plan.grants.map((grant) => grant.permissionCode),
      expiresAt: plan.expiresAt.toISOString(),
      outcome: 'success',
    },
  });
  await input.repository.appendAuditEvent(completed);

  return {
    operationId: plan.operationId,
    userId: plan.userId,
    membershipId: plan.membershipId,
    expiresAt: plan.expiresAt,
    permissionCodes: plan.grants.map((grant) => grant.permissionCode),
    auditEventIds: [initiated.eventId, completed.eventId],
  };
}

export async function revokeFirstUserAccess(input: {
  repository: ProvisioningRepository;
  email: string;
  userId: string;
  operationId: string;
  scope: ScopeIds;
  auditKey: { keyId: string; secret: string };
}): Promise<RevokeResult | { status: 'absent' | 'already-disabled' }> {
  const email = normalizeEmail(input.email);
  assertUuid('user ID', input.userId);
  assertUuid('operation ID', input.operationId);
  await input.repository.lockEmail(email);
  const scope = await input.repository.loadScope(input.scope);
  assertActiveScope(scope, input.scope);
  const existing = await input.repository.findIdentityByEmail(email, input.scope.tenantId);
  if (!existing) return { status: 'absent' };
  if (existing.id !== input.userId) {
    throw new ProvisioningError('The target email does not match the requested user identity');
  }
  const membership = existing.memberships.find(
    (candidate) => candidate.tenantId === input.scope.tenantId,
  );
  if (!membership) return { status: 'absent' };
  if (membership.identityId !== existing.id) {
    throw new ProvisioningError('The target membership is linked to a different identity');
  }
  if (membership.status === 'DISABLED') return { status: 'already-disabled' };
  if (membership.status !== 'ACTIVE') {
    throw new ProvisioningError(
      'Cleanup refuses a target membership that is not ACTIVE or DISABLED',
    );
  }
  if (membership.roleAssignmentCount > 0) {
    throw new ProvisioningError(
      'Cleanup refuses to disable a membership that has role assignments; revoke only the named temporary grants through an approved operator procedure',
    );
  }

  if (existing.memberships.length !== 1) {
    throw new ProvisioningError(
      'Cleanup refuses an identity with memberships outside the temporary release account',
    );
  }

  const operationReason = provisioningReason(input.operationId);
  const unrevokedGrants = await input.repository.listUnrevokedTemporaryGrants({
    tenantId: input.scope.tenantId,
    membershipId: membership.id,
    operationId: input.operationId,
  });
  const matchingGrantIds: string[] = [];
  for (const grant of READ_ONLY_GRANT_PLAN) {
    const expectedScope = scopeForGrant(grant, input.scope);
    const matches = unrevokedGrants.filter(
      (candidate) =>
        candidate.reason === operationReason &&
        candidate.permissionCode === grant.permissionCode &&
        candidate.scopeType === expectedScope.scopeType &&
        candidate.legalEntityId === (expectedScope.legalEntityId ?? null) &&
        candidate.stationId === (expectedScope.stationId ?? null),
    );
    if (matches.length !== 1) {
      throw new ProvisioningError(
        'Cleanup requires exactly one unrevoked grant for every grant created by this operation',
      );
    }
    matchingGrantIds.push(matches[0]!.id);
  }
  if (unrevokedGrants.some((grant) => !matchingGrantIds.includes(grant.id))) {
    throw new ProvisioningError(
      'Cleanup refuses to disable a membership with unrelated unrevoked temporary grants',
    );
  }

  const now = await input.repository.now();
  const expiry = new Date(now.getTime() + 1);
  const plan: ProvisioningPlan = {
    now,
    expiresAt: expiry,
    operationId: input.operationId,
    userId: existing.id,
    membershipId: membership.id,
    scope,
    grants: READ_ONLY_GRANT_PLAN,
  };
  if (input.repository.revokeAtomic) {
    const event = auditEvent({
      actionCode: 'ACCESS.PROVISIONING_REVOKED',
      plan,
      subjectId: existing.id,
      membershipId: membership.id,
      key: input.auditKey,
      metadata: {
        permissionCodes: READ_ONLY_GRANT_PLAN.map((grant) => grant.permissionCode),
        revokedGrantCount: matchingGrantIds.length,
        membershipDisabled: true,
        outcome: 'success',
      },
    });
    const result = await input.repository.revokeAtomic({
      userId: existing.id,
      membershipId: membership.id,
      operationId: input.operationId,
      tenantId: scope.tenant.id,
      legalEntityId: scope.legalEntity.id,
      stationId: scope.station.id,
      event,
    });
    return {
      operationId: input.operationId,
      userId: existing.id,
      membershipId: membership.id,
      ...result,
      auditEventId: event.eventId,
    };
  }

  await input.repository.setTenantContext({
    tenantId: scope.tenant.id,
    legalEntityId: scope.legalEntity.id,
    stationId: scope.station.id,
    actorId: existing.id,
    membershipId: membership.id,
  });
  const revokedGrantCount = await input.repository.revokeTemporaryGrants({
    tenantId: input.scope.tenantId,
    membershipId: membership.id,
    grantIds: matchingGrantIds,
    reason: operationReason,
  });
  if (revokedGrantCount !== matchingGrantIds.length) {
    throw new ProvisioningError('Cleanup could not revoke the exact operation grant set');
  }
  const revokedSessionCount = await input.repository.revokeSessions(existing.id);
  const event = auditEvent({
    actionCode: 'ACCESS.PROVISIONING_REVOKED',
    plan,
    subjectId: existing.id,
    membershipId: membership.id,
    key: input.auditKey,
    metadata: {
      permissionCodes: READ_ONLY_GRANT_PLAN.map((grant) => grant.permissionCode),
      revokedGrantCount,
      revokedSessionCount,
      membershipDisabled: true,
      outcome: 'success',
    },
  });

  await input.repository.appendAuditEvent(event);
  const membershipDisabled = await input.repository.disableMembership({
    tenantId: input.scope.tenantId,
    membershipId: membership.id,
    identityId: existing.id,
  });
  if (!membershipDisabled)
    throw new ProvisioningError('Target membership disappeared during cleanup');

  return {
    operationId: input.operationId,
    userId: existing.id,
    membershipId: membership.id,
    revokedGrantCount,
    revokedSessionCount,
    membershipDisabled,
    auditEventId: event.eventId,
  };
}

type Query = Sql | TransactionSql;

type ScopeRow = {
  id: string;
  name: string;
  status: string;
  tenant_id?: string;
  legal_entity_id?: string;
  code?: string;
};

type UserRow = { id: string; name: string; email: string };
type AccountRow = {
  id: string;
  account_id: string;
  provider_id: string;
  user_id: string;
  password: string | null;
};
type MembershipRow = {
  id: string;
  tenant_id: string;
  identity_id: string;
  status: string;
  role_assignment_count: number;
};

type ScopeOptionsPayload = {
  tenants: ScopeRow[];
  legalEntities: Array<{ id: string; tenantId: string; name: string; status: string }>;
  stations: Array<{
    id: string;
    tenantId: string;
    legalEntityId: string;
    code: string;
    name: string;
    status: string;
  }>;
};

type IdentityPayload = {
  id: string;
  name: string;
  email: string;
  accounts: Array<{
    id: string;
    accountId: string;
    providerId: string;
    userId: string;
    hasPassword: boolean;
  }>;
  memberships: Array<{
    id: string;
    tenantId: string;
    identityId: string;
    status: string;
    roleAssignmentCount: number;
  }>;
};

type GrantPayload = {
  id: string;
  tenantId: string;
  membershipId: string;
  permissionCode: string;
  scopeType: ReadOnlyGrantScope;
  legalEntityId: string | null;
  stationId: string | null;
  reason: string;
};

function parseJson<T>(value: unknown, message: string): T {
  if (!value || typeof value !== 'object') throw new ProvisioningError(message);
  return value as T;
}

function one<T>(rows: readonly T[], message: string): T {
  const row = rows[0];
  if (!row) throw new ProvisioningError(message);
  return row;
}

export function createPostgresRepository(query: Query): ProvisioningRepository {
  return {
    async now() {
      const rows = await query<{ now: Date }[]>`select clock_timestamp() as now`;
      return one(rows, 'Database returned no clock value').now;
    },
    async lockEmail(email) {
      await query`select pg_advisory_xact_lock(hashtextextended(${email}, 0))`;
    },
    async loadScope(ids) {
      const rows = await query<{ value: ScopeOptionsPayload }[]>`
        select platform.first_user_provisioning_scope_options(
          ${ids.tenantId}::uuid, ${ids.legalEntityId}::uuid, ${ids.stationId}::uuid
        ) as value
      `;
      const options = parseJson<ScopeOptionsPayload>(
        one(rows, 'Database returned no scope options').value,
        'Database returned invalid scope options',
      );
      const tenant = one(options.tenants, 'Selected tenant was not found');
      const legalEntity = one(options.legalEntities, 'Selected legal entity was not found');
      const station = one(options.stations, 'Selected station was not found');
      return {
        tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
        legalEntity: {
          id: legalEntity.id,
          tenantId: legalEntity.tenantId,
          name: legalEntity.name,
          status: legalEntity.status,
        },
        station: {
          id: station.id,
          tenantId: station.tenantId,
          legalEntityId: station.legalEntityId,
          code: station.code!,
          name: station.name,
          status: station.status,
        },
      };
    },
    async findIdentityByEmail(email, tenantId) {
      const rows = await query<{ value: IdentityPayload | null }[]>`
        select platform.first_user_provisioning_identity(
          ${email}, ${tenantId ?? null}::uuid
        ) as value
      `;
      const value = one(rows, 'Database returned no identity result').value;
      if (value === null) return null;
      const identity = parseJson<IdentityPayload>(value, 'Database returned invalid identity data');
      return identity;
    },
    async listPermissionDefinitions() {
      const rows = await query<{ codes: string[] }[]>`
        select platform.first_user_provisioning_permission_definitions() as codes
      `;
      return one(rows, 'Database returned no permission result').codes;
    },
    async setTenantContext() {
      // The database capability sets and validates its own context. Keeping
      // this method a no-op prevents the local tool from manufacturing an
      // application membership context for direct table writes.
    },
    async insertUser(input) {
      void input;
      throw new ProvisioningError(
        'PostgreSQL provisioning requires the atomic database capability',
      );
    },
    async insertCredentialAccount(input) {
      void input;
      throw new ProvisioningError(
        'PostgreSQL provisioning requires the atomic database capability',
      );
    },
    async insertMembership(input) {
      void input;
      throw new ProvisioningError(
        'PostgreSQL provisioning requires the atomic database capability',
      );
    },
    async insertGrant(input) {
      void input;
      throw new ProvisioningError(
        'PostgreSQL provisioning requires the atomic database capability',
      );
    },
    async appendAuditEvent(event) {
      await query`
        select platform.first_user_provisioning_append_failure(
          ${event.tenantId}::uuid, ${query.json(JSON.parse(JSON.stringify(event)))}::jsonb
        )
      `;
    },
    async listUnrevokedTemporaryGrants(input) {
      const rows = await query<{ value: GrantPayload[] }[]>`
        select platform.first_user_provisioning_grants(
          ${input.tenantId}::uuid, ${input.membershipId}::uuid, ${input.operationId}::uuid
        ) as value
      `;
      return parseJson<GrantPayload[]>(
        one(rows, 'Database returned no grant result').value,
        'Database returned invalid grant data',
      );
    },
    async revokeTemporaryGrants(input) {
      void input;
      throw new ProvisioningError('PostgreSQL revoke requires the atomic database capability');
    },
    async revokeSessions(userId) {
      void userId;
      throw new ProvisioningError('PostgreSQL revoke requires the atomic database capability');
    },
    async disableMembership(input) {
      void input;
      throw new ProvisioningError('PostgreSQL revoke requires the atomic database capability');
    },
    async provisionAtomic(input) {
      await query`
        select platform.first_user_provisioning_provision(
          ${input.userId}::uuid,
          ${input.membershipId}::uuid,
          ${input.operationId}::uuid,
          ${input.tenantId}::uuid,
          ${input.legalEntityId}::uuid,
          ${input.stationId}::uuid,
          ${input.email},
          ${input.displayName},
          ${input.passwordHash},
          ${input.expiresAt}::timestamptz,
          ${query.json(JSON.parse(JSON.stringify(input.initiatedEvent)))}::jsonb,
          ${query.json(JSON.parse(JSON.stringify(input.completedEvent)))}::jsonb
        )
      `;
    },
    async revokeAtomic(input) {
      const rows = await query<
        {
          value: {
            revokedGrantCount: number;
            revokedSessionCount: number;
            membershipDisabled: boolean;
          };
        }[]
      >`
        select platform.first_user_provisioning_revoke(
          ${input.userId}::uuid,
          ${input.membershipId}::uuid,
          ${input.operationId}::uuid,
          ${input.tenantId}::uuid,
          ${input.legalEntityId}::uuid,
          ${input.stationId}::uuid,
          ${query.json(JSON.parse(JSON.stringify(input.event)))}::jsonb
        ) as value
      `;
      return parseJson<{
        revokedGrantCount: number;
        revokedSessionCount: number;
        membershipDisabled: boolean;
      }>(
        one(rows, 'Database returned no revoke result').value,
        'Database returned invalid revoke data',
      );
    },
  };
}

export type ScopeListing = Readonly<{
  tenants: readonly { id: string; name: string; status: string }[];
  legalEntities: readonly { id: string; tenantId: string; name: string; status: string }[];
  stations: readonly {
    id: string;
    tenantId: string;
    legalEntityId: string;
    code: string;
    name: string;
    status: string;
  }[];
}>;

export async function listScopeOptions(
  query: Query,
  filters: Partial<ScopeIds> = {},
): Promise<ScopeListing> {
  const rows = await query<{ value: ScopeOptionsPayload }[]>`
    select platform.first_user_provisioning_scope_options(
      ${filters.tenantId ?? null}::uuid,
      ${filters.legalEntityId ?? null}::uuid,
      ${filters.stationId ?? null}::uuid
    ) as value
  `;
  return parseJson<ScopeListing>(
    one(rows, 'Database returned no scope options').value,
    'Database returned invalid scope options',
  );
}

function databaseUrlFromEnvironment(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.APP_ENV !== 'local') {
    throw new ProvisioningError('This local-only tool requires APP_ENV=local');
  }
  const url = environment.DATABASE_DIRECT_URL ?? environment.DATABASE_URL;
  if (!url)
    throw new ProvisioningError('DATABASE_DIRECT_URL or DATABASE_URL must be supplied locally');
  return url;
}

export const ACCEPTED_PROVIDER_MEMBERSHIP = {
  grantedRole: ACCEPTED_PROVISIONING_DB_ROLE,
  member: 'migration_owner',
  grantor: 'cloud_admin',
  adminOption: true,
  inheritOption: false,
  setOption: false,
} as const;

export type DatabaseRoleMembershipSnapshot = Readonly<{
  grantedRole: string;
  member: string;
  grantor: string;
  adminOption: boolean;
  inheritOption: boolean;
  setOption: boolean;
}>;

export type DatabaseRoleSnapshot = Readonly<{
  currentUser: string;
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolinherit: boolean;
  rolreplication: boolean;
  rolconfig: readonly string[] | null;
  memberships: readonly DatabaseRoleMembershipSnapshot[];
  memberCapability: boolean;
  usageCapability: boolean;
  setCapability: boolean;
  adminCapability: boolean;
  databaseOwner: boolean;
  schemaOwner: boolean;
  applicationTableOwner: boolean;
  unexpectedDirectTablePrivileges: boolean;
  unexpectedFunctionPrivileges: boolean;
  missingExpectedFunctionPrivileges: boolean;
}>;

function assertRoleCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ProvisioningError(message);
}

export function assertAcceptedProvisioningRole(row: DatabaseRoleSnapshot): void {
  assertRoleCondition(
    row.currentUser === ACCEPTED_PROVISIONING_DB_ROLE,
    `Provisioning requires the approved ${ACCEPTED_PROVISIONING_DB_ROLE} database role`,
  );
  assertRoleCondition(
    row.rolcanlogin &&
      !row.rolsuper &&
      !row.rolbypassrls &&
      !row.rolcreatedb &&
      !row.rolcreaterole &&
      !row.rolinherit &&
      !row.rolreplication,
    'Provisioning requires the approved non-superuser, NOBYPASSRLS role attributes',
  );
  assertRoleCondition(row.rolconfig === null, 'Provisioning role configuration is unexpected');

  assertRoleCondition(
    row.memberships.length === 1 &&
      row.memberships[0]?.grantedRole === ACCEPTED_PROVIDER_MEMBERSHIP.grantedRole &&
      row.memberships[0]?.member === ACCEPTED_PROVIDER_MEMBERSHIP.member &&
      row.memberships[0]?.grantor === ACCEPTED_PROVIDER_MEMBERSHIP.grantor &&
      row.memberships[0]?.adminOption === ACCEPTED_PROVIDER_MEMBERSHIP.adminOption &&
      row.memberships[0]?.inheritOption === ACCEPTED_PROVIDER_MEMBERSHIP.inheritOption &&
      row.memberships[0]?.setOption === ACCEPTED_PROVIDER_MEMBERSHIP.setOption,
    'Provisioning role membership does not match the exact approved provider relationship',
  );
  assertRoleCondition(
    row.memberCapability && !row.usageCapability && !row.setCapability && row.adminCapability,
    'Provisioning role has unexpected effective membership capabilities',
  );

  assertRoleCondition(
    !row.databaseOwner && !row.schemaOwner && !row.applicationTableOwner,
    'Provisioning role has unexpected ownership',
  );
  assertRoleCondition(
    !row.unexpectedDirectTablePrivileges,
    'Provisioning role has an unexpected direct table privilege',
  );
  assertRoleCondition(
    !row.unexpectedFunctionPrivileges && !row.missingExpectedFunctionPrivileges,
    'Provisioning role has an unexpected function privilege',
  );
}

export async function loadDatabaseRoleSnapshot(client: Sql): Promise<DatabaseRoleSnapshot> {
  const rows = await client<DatabaseRoleSnapshot[]>`
    with expected_functions(oid) as (
      values
        ('platform.first_user_provisioning_assert_runtime_role()'::regprocedure::oid),
        ('platform.first_user_provisioning_scope_options(uuid,uuid,uuid)'::regprocedure::oid),
        ('platform.first_user_provisioning_identity(text,uuid)'::regprocedure::oid),
        ('platform.first_user_provisioning_permission_definitions()'::regprocedure::oid),
        ('platform.first_user_provisioning_grants(uuid,uuid,uuid)'::regprocedure::oid),
        ('platform.first_user_provisioning_provision(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb,jsonb)'::regprocedure::oid),
        ('platform.first_user_provisioning_revoke(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure::oid),
        ('platform.first_user_provisioning_append_failure(uuid,jsonb)'::regprocedure::oid)
    )
    select
      current_user as "currentUser",
      r.rolcanlogin,
      r.rolsuper,
      r.rolbypassrls,
      r.rolcreatedb,
      r.rolcreaterole,
      r.rolinherit,
      r.rolreplication,
      r.rolconfig,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'grantedRole', granted_role.rolname,
          'member', member_role.rolname,
          'grantor', grantor_role.rolname,
          'adminOption', membership.admin_option,
          'inheritOption', membership.inherit_option,
          'setOption', membership.set_option
        ) order by granted_role.rolname, member_role.rolname, grantor_role.rolname)
        from pg_auth_members membership
        join pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_roles member_role on member_role.oid = membership.member
        join pg_roles grantor_role on grantor_role.oid = membership.grantor
        where granted_role.rolname = ${ACCEPTED_PROVISIONING_DB_ROLE}
           or member_role.rolname = ${ACCEPTED_PROVISIONING_DB_ROLE}
      ), '[]'::jsonb) as memberships,
      pg_has_role('migration_owner', ${ACCEPTED_PROVISIONING_DB_ROLE}, 'MEMBER') as "memberCapability",
      pg_has_role('migration_owner', ${ACCEPTED_PROVISIONING_DB_ROLE}, 'USAGE') as "usageCapability",
      pg_has_role('migration_owner', ${ACCEPTED_PROVISIONING_DB_ROLE}, 'SET') as "setCapability",
      exists (
        select 1
        from pg_auth_members membership
        join pg_roles granted_role on granted_role.oid = membership.roleid
        join pg_roles member_role on member_role.oid = membership.member
        join pg_roles grantor_role on grantor_role.oid = membership.grantor
        where granted_role.rolname = ${ACCEPTED_PROVISIONING_DB_ROLE}
          and member_role.rolname = 'migration_owner'
          and grantor_role.rolname = 'cloud_admin'
          and membership.admin_option
      ) as "adminCapability",
      exists (
        select 1 from pg_database d
        where d.datname = current_database() and d.datdba = r.oid
      ) as "databaseOwner",
      exists (select 1 from pg_namespace n where n.nspowner = r.oid) as "schemaOwner",
      exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('app', 'auth', 'platform') and c.relowner = r.oid
      ) as "applicationTableOwner",
      exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
        where n.nspname in ('app', 'auth', 'platform') and acl.grantee = r.oid
      ) as "unexpectedDirectTablePrivileges",
      (
        exists (
          select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where n.nspname in ('app', 'auth', 'platform')
            and acl.grantee = r.oid
            and p.oid not in (select oid from expected_functions)
        ) or exists (
          select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'platform'
            and p.oid not in (select oid from expected_functions)
            and has_function_privilege(${ACCEPTED_PROVISIONING_DB_ROLE}, p.oid, 'EXECUTE')
        )
      ) as "unexpectedFunctionPrivileges",
      exists (
        select 1
        from expected_functions expected
        where not has_function_privilege(${ACCEPTED_PROVISIONING_DB_ROLE}, expected.oid, 'EXECUTE')
      ) as "missingExpectedFunctionPrivileges"
    from pg_roles r
    where r.rolname = current_user
  `;
  return one(rows, 'Unable to validate database connection privileges');
}

async function assertPrivilegedDirectConnection(client: Sql): Promise<void> {
  const row = await loadDatabaseRoleSnapshot(client);
  assertAcceptedProvisioningRole(row);
  await client`select platform.first_user_provisioning_assert_runtime_role()`;
}

export type HiddenPasswordInput = NodeJS.ReadableStream & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
};

export type HiddenPasswordOutput = NodeJS.WritableStream & { isTTY?: boolean };

export function readHiddenPassword(
  input: HiddenPasswordInput = process.stdin,
  output: HiddenPasswordOutput = process.stdout,
): Promise<string> {
  if (!input.isTTY || !output.isTTY || !input.setRawMode) {
    throw new ProvisioningError('Provisioning password input requires an interactive local TTY');
  }
  return new Promise<string>((resolve, reject) => {
    let password = '';
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode?.(false);
      input.pause();
    };
    const onData = (chunk: Buffer | string) => {
      const value = chunk.toString();
      for (const character of value) {
        if (character === '\u0003') {
          cleanup();
          reject(new ProvisioningError('Password input cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          output.write('\n');
          resolve(password);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1);
        } else {
          password += character;
        }
      }
    };
    output.write('Password (hidden): ');
    input.setRawMode!(true);
    input.resume();
    input.on('data', onData);
  });
}

export function formatSafeError(error: unknown): string {
  if (error instanceof ProvisioningError) return error.message;
  return 'Provisioning tool failed; inspect the local audit event for the classified failure';
}

function takeValue(args: readonly string[], index: number, flag: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new ProvisioningError(`${flag} requires a value`);
  return [value, index + 1];
}

type CliMode = 'inspect' | 'dry-run' | 'provision' | 'revoke';
type CliOptions = {
  mode: CliMode;
  environment: 'production';
  confirmProduction: boolean;
  confirmCleanup: boolean;
  email?: string;
  userId?: string;
  operationId?: string;
  displayName?: string;
  expiresAt?: string;
  scope?: Partial<ScopeIds>;
};

export function parseCli(args: readonly string[]): CliOptions {
  let mode: CliMode | undefined;
  let environment: 'production' | undefined;
  const options: CliOptions = {
    mode: 'inspect',
    environment: 'production',
    confirmProduction: false,
    confirmCleanup: false,
  };
  const selectMode = (nextMode: CliMode): void => {
    if (mode && mode !== nextMode) {
      throw new ProvisioningError(
        'Select exactly one of --inspect, --dry-run, --provision, or --revoke',
      );
    }
    mode = nextMode;
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--inspect') selectMode('inspect');
    else if (arg === '--dry-run') selectMode('dry-run');
    else if (arg === '--provision') selectMode('provision');
    else if (arg === '--revoke') selectMode('revoke');
    else if (arg === '--environment') {
      const [value, next] = takeValue(args, index, arg);
      index = next;
      if (value !== 'production') throw new ProvisioningError('--environment must be production');
      environment = 'production';
    } else if (arg === '--confirm-production-provisioning') options.confirmProduction = true;
    else if (arg === '--confirm-production-cleanup') options.confirmCleanup = true;
    else if (arg === '--email') [options.email, index] = takeValue(args, index, arg);
    else if (arg === '--user-id') [options.userId, index] = takeValue(args, index, arg);
    else if (arg === '--operation-id') [options.operationId, index] = takeValue(args, index, arg);
    else if (arg === '--display-name') [options.displayName, index] = takeValue(args, index, arg);
    else if (arg === '--expires-at') [options.expiresAt, index] = takeValue(args, index, arg);
    else if (arg === '--tenant-id') {
      const [value, next] = takeValue(args, index, arg);
      index = next;
      options.scope = { ...options.scope, tenantId: value };
    } else if (arg === '--legal-entity-id') {
      const [value, next] = takeValue(args, index, arg);
      index = next;
      options.scope = { ...options.scope, legalEntityId: value };
    } else if (arg === '--station-id') {
      const [value, next] = takeValue(args, index, arg);
      index = next;
      options.scope = { ...options.scope, stationId: value };
    } else if (arg === '--help') {
      throw new ProvisioningError(usage());
    } else {
      throw new ProvisioningError('Unknown command-line option');
    }
  }
  if (!environment) throw new ProvisioningError('--environment production is required');
  options.mode = mode ?? 'inspect';
  if (options.mode === 'provision' || options.mode === 'dry-run') {
    if (!options.confirmProduction) {
      throw new ProvisioningError(`${options.mode} requires --confirm-production-provisioning`);
    }
    if (!options.email || !options.displayName || !options.expiresAt) {
      throw new ProvisioningError(
        `${options.mode} requires --email, --display-name, and --expires-at`,
      );
    }
  }
  if (options.mode === 'revoke') {
    if (!options.confirmCleanup)
      throw new ProvisioningError('--revoke requires --confirm-production-cleanup');
    if (!options.email || !options.userId || !options.operationId) {
      throw new ProvisioningError('--revoke requires --email, --user-id, and --operation-id');
    }
  }
  if (
    options.mode !== 'inspect' &&
    (!options.scope?.tenantId || !options.scope.legalEntityId || !options.scope.stationId)
  ) {
    throw new ProvisioningError(
      `${options.mode} requires --tenant-id, --legal-entity-id, and --station-id`,
    );
  }
  return options;
}

function usage(): string {
  return [
    'Local-only first production user provisioning tool',
    '',
    'Inspect scope labels:',
    '  node --conditions=react-server --import tsx scripts/first-user-provisioning.ts --inspect --environment production',
    '',
    'Dry-run (zero writes):',
    '  node --conditions=react-server --import tsx scripts/first-user-provisioning.ts --dry-run --environment production --confirm-production-provisioning --email <email> --display-name <name> --tenant-id <tenant-uuid> --legal-entity-id <legal-entity-uuid> --station-id <station-uuid> --expires-at <iso-timestamp>',
    '',
    'Provision (hidden TTY password; never a password argument):',
    '  node --conditions=react-server --import tsx scripts/first-user-provisioning.ts --provision --environment production --confirm-production-provisioning --email <email> --display-name <name> --tenant-id <tenant-uuid> --legal-entity-id <legal-entity-uuid> --station-id <station-uuid> --expires-at <iso-timestamp>',
    '',
    'Cleanup:',
    '  node --conditions=react-server --import tsx scripts/first-user-provisioning.ts --revoke --environment production --confirm-production-cleanup --email <email> --user-id <user-uuid> --operation-id <operation-uuid> --tenant-id <tenant-uuid> --legal-entity-id <legal-entity-uuid> --station-id <station-uuid>',
  ].join('\n');
}

function requireFullScope(scope: Partial<ScopeIds> | undefined): ScopeIds {
  if (!scope?.tenantId || !scope.legalEntityId || !scope.stationId) {
    throw new ProvisioningError('A complete tenant/legal-entity/station scope is required');
  }
  return {
    tenantId: scope.tenantId,
    legalEntityId: scope.legalEntityId,
    stationId: scope.stationId,
  };
}

function parseExpiryText(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new ProvisioningError('--expires-at must be an ISO timestamp');
  return date;
}

function printScopeListing(listing: ScopeListing): void {
  for (const tenant of listing.tenants) {
    console.log(`tenant ${tenant.id} | ${tenant.name} | ${tenant.status}`);
  }
  for (const legalEntity of listing.legalEntities) {
    console.log(`legal-entity ${legalEntity.id} | ${legalEntity.name} | ${legalEntity.status}`);
  }
  for (const station of listing.stations) {
    console.log(`station ${station.id} | ${station.code} | ${station.name} | ${station.status}`);
  }
}

function printRedactedPlan(plan: ProvisioningPlan): void {
  console.log(
    JSON.stringify({
      mode: 'dry-run',
      writes: {
        authUser: 1,
        credentialAccount: 1,
        membership: 1,
        temporaryPermissionGrants: plan.grants.length,
        sessions: 0,
      },
      scope: {
        tenantId: plan.scope.tenant.id,
        tenantName: plan.scope.tenant.name,
        legalEntityId: plan.scope.legalEntity.id,
        legalEntityName: plan.scope.legalEntity.name,
        stationId: plan.scope.station.id,
        stationCode: plan.scope.station.code,
        stationName: plan.scope.station.name,
      },
      permissions: plan.grants,
      operationId: plan.operationId,
      expiresAt: plan.expiresAt.toISOString(),
      audit: ['ACCESS.PROVISIONING_INITIATED', 'ACCESS.PROVISIONING_COMPLETED'],
      password: 'hidden',
    }),
  );
}

async function withDirectTransaction<T>(
  client: Sql,
  readOnly: boolean,
  callback: (transaction: TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await client.begin<T>(async (transaction): Promise<T> => {
    if (readOnly) await transaction.unsafe('set transaction read only');
    return await callback(transaction);
  });
  return result as T;
}

type FailureAuditContext = Readonly<{
  mode: 'provision' | 'revoke';
  scope: ScopeIds;
  auditKey: { keyId: string; secret: string };
}>;

async function appendFailureAudit(
  client: Sql,
  context: FailureAuditContext,
  errorType: string,
): Promise<void> {
  await withDirectTransaction(client, false, async (transaction) => {
    const repository = createPostgresRepository(transaction);
    const occurredAt = await repository.now();
    const event = signSecurityEvent(
      {
        eventId: randomUUID(),
        tenantId: context.scope.tenantId,
        eventCode: 'ACCESS.PROVISIONING_FAILED',
        requestId: randomUUID(),
        occurredAt: occurredAt.toISOString(),
        details: {
          actorType: 'SUPPORT',
          initiatedBy: TOOL_NAME,
          subjectType: 'access.provisioning.request',
          subjectId: context.mode,
          metadata: {
            mode: context.mode,
            tenantId: context.scope.tenantId,
            legalEntityId: context.scope.legalEntityId,
            stationId: context.scope.stationId,
            errorType,
            outcome: 'failure',
          },
        },
      },
      context.auditKey,
    );
    await repository.appendAuditEvent(event);
  });
}

async function main(): Promise<void> {
  let client: Sql | undefined;
  let failureAuditContext: FailureAuditContext | undefined;
  try {
    const options = parseCli(process.argv.slice(2));
    const url = databaseUrlFromEnvironment();
    const { default: postgres } = await import('postgres');
    client = postgres(url, { max: 1, prepare: false });
    await assertPrivilegedDirectConnection(client);

    if (options.mode === 'inspect') {
      const listing = await withDirectTransaction(client, true, (transaction) =>
        listScopeOptions(transaction, options.scope),
      );
      printScopeListing(listing);
      return;
    }

    const scope = requireFullScope(options.scope);

    if (options.mode === 'dry-run') {
      const plan = await withDirectTransaction(client, true, async (transaction) => {
        const repository = createPostgresRepository(transaction);
        return preparePlan(repository, {
          email: options.email!,
          displayName: options.displayName!,
          scope,
          expiresAt: parseExpiryText(options.expiresAt!),
          lockScope: false,
        });
      });
      printRedactedPlan(plan);
      return;
    }

    if (options.mode === 'provision') {
      const auditKey = {
        keyId: process.env.AUDIT_SIGNING_KEY_ID ?? '',
        secret: process.env.AUDIT_SIGNING_KEY ?? '',
      };
      if (!auditKey.keyId || !auditKey.secret) {
        throw new ProvisioningError(
          'AUDIT_SIGNING_KEY_ID and AUDIT_SIGNING_KEY are required locally',
        );
      }
      failureAuditContext = { mode: 'provision', scope, auditKey };
      let password = await readHiddenPassword();
      try {
        const result = await withDirectTransaction(client, false, async (transaction) =>
          provisionFirstUser({
            repository: createPostgresRepository(transaction),
            request: {
              email: options.email!,
              displayName: options.displayName!,
              scope,
              expiresAt: parseExpiryText(options.expiresAt!),
            },
            password,
            auditKey,
          }),
        );
        console.log(
          JSON.stringify({
            status: 'provisioned',
            operationId: result.operationId,
            userId: result.userId,
            membershipId: result.membershipId,
            permissionCodes: result.permissionCodes,
            expiresAt: result.expiresAt.toISOString(),
            auditEventIds: result.auditEventIds,
            password: 'hidden',
          }),
        );
      } finally {
        password = '';
      }
      return;
    }

    const auditKey = {
      keyId: process.env.AUDIT_SIGNING_KEY_ID ?? '',
      secret: process.env.AUDIT_SIGNING_KEY ?? '',
    };
    if (!auditKey.keyId || !auditKey.secret) {
      throw new ProvisioningError(
        'AUDIT_SIGNING_KEY_ID and AUDIT_SIGNING_KEY are required locally',
      );
    }
    failureAuditContext = { mode: 'revoke', scope, auditKey };
    const result = await withDirectTransaction(client, false, async (transaction) =>
      revokeFirstUserAccess({
        repository: createPostgresRepository(transaction),
        email: options.email!,
        userId: options.userId!,
        operationId: options.operationId!,
        scope,
        auditKey,
      }),
    );
    console.log(JSON.stringify({ status: 'cleanup-complete', ...result }));
  } catch (error) {
    if (client && failureAuditContext) {
      try {
        await appendFailureAudit(
          client,
          failureAuditContext,
          error instanceof ProvisioningError ? error.name : 'DatabaseError',
        );
      } catch {
        console.error('Provisioning failure audit could not be persisted');
      }
    }
    console.error(formatSafeError(error));
    process.exitCode = 1;
  } finally {
    if (client) await client.end({ timeout: 1 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
