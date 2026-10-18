import 'server-only';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase, type Database, type TenantTransactionContext } from '../../platform/db';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { AppError } from '../../platform/errors';
import {
  PERMISSION_CODES,
  ROLE_CODES,
  assertSessionActive,
  assertValidScope,
  type AuthorizationActor,
  type PermissionCode,
  type RoleAssignment,
  type RoleCode,
  type ScopeType,
  type TemporaryPermissionGrant,
} from '../../platform/security';
import {
  requireAuthenticatedActor,
  type AuthenticatedActorContext,
  type AuthenticatedActorResolver,
} from '../identity';
import { assertActiveTenantMembership, type MembershipStatus } from './access';
import { reuseRequestAuthority } from './request-authority';
import { memoizeRequestRead } from '../../platform/security/request-read-scope';

const membershipStatusSchema = z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DISABLED']);
const roleCodeSchema = z.enum(ROLE_CODES);
const permissionCodeSchema = z.enum(PERMISSION_CODES);
const scopeTypeSchema = z.enum(['TENANT', 'LEGAL_ENTITY', 'STATION']);

export type MembershipRecord = {
  tenantId: string;
  membershipId: string;
  identityId: string;
  actorId: string;
  status: MembershipStatus;
  roleAssignments: readonly RoleAssignment[];
  temporaryGrants: readonly TemporaryPermissionGrant[];
};

export type TenantMembershipLoader = (
  identityId: string,
  tenantId: string,
) => Promise<MembershipRecord | null>;

export type TenantExecutionContext = {
  readonly actor: AuthenticatedActorContext;
  readonly membership: MembershipRecord;
  readonly authorization: AuthorizationActor;
  readonly transaction: TenantTransactionContext;
};

type MembershipRow = {
  tenant_id: string;
  membership_id: string;
  identity_id: string;
  status: string;
};

type RoleAssignmentRow = {
  tenant_id: string;
  role_code: string;
  scope_type: string;
  legal_entity_id: string | null;
  station_id: string | null;
  expires_at: Date | null;
};

type TemporaryGrantRow = {
  tenant_id: string;
  permission_code: string;
  scope_type: string;
  legal_entity_id: string | null;
  station_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
};

function scopeFromRow(row: {
  tenant_id: string;
  scope_type: string;
  legal_entity_id: string | null;
  station_id: string | null;
}): {
  tenantId: string;
  scopeType: ScopeType;
  legalEntityId?: string;
  stationId?: string;
} {
  const scope = {
    tenantId: row.tenant_id,
    scopeType: scopeTypeSchema.parse(row.scope_type),
    ...(row.legal_entity_id ? { legalEntityId: row.legal_entity_id } : {}),
    ...(row.station_id ? { stationId: row.station_id } : {}),
  };
  assertValidScope(scope);
  return scope;
}

export function roleAssignmentFromRow(row: RoleAssignmentRow): RoleAssignment {
  return {
    ...scopeFromRow(row),
    roleCode: roleCodeSchema.parse(row.role_code),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at) } : {}),
  };
}

export function temporaryGrantFromRow(row: TemporaryGrantRow): TemporaryPermissionGrant {
  return {
    ...scopeFromRow(row),
    permissionCode: permissionCodeSchema.parse(row.permission_code),
    expiresAt: new Date(row.expires_at),
  };
}

/**
 * Load membership authority through a pre-tenant identity lookup. The first
 * query is constrained by the authenticated identity; only after an ACTIVE
 * membership is found does the transaction set tenant context and load scopes.
 */
export async function loadTenantMembershipWithDatabase(
  identityId: string,
  tenantId: string,
  database: Pick<Database, 'transaction'>,
): Promise<MembershipRecord | null> {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.actor_id', ${identityId}, true)`);
    const membershipRows = (await transaction.execute(sql`
      select
        m.tenant_id,
        m.id as membership_id,
        m.identity_id,
        m.status
      from app.memberships m
      where m.tenant_id = ${tenantId}
        and m.identity_id = ${identityId}
      limit 1
    `)) as unknown as MembershipRow[];
    const row = membershipRows[0];
    if (!row) return null;

    const status = membershipStatusSchema.parse(row.status);
    if (status !== 'ACTIVE') {
      return {
        tenantId: row.tenant_id,
        membershipId: row.membership_id,
        identityId: row.identity_id,
        actorId: row.identity_id,
        status,
        roleAssignments: [],
        temporaryGrants: [],
      };
    }

    await transaction.execute(sql`
      select
        set_config('app.tenant_id', ${row.tenant_id}, true),
        set_config('app.membership_id', ${row.membership_id}, true)
    `);
    // Both sets require the same verified tenant context. UNION ALL fetches
    // them in one round trip without joining/multiplying independent grants.
    const assignments = (await transaction.execute(sql`
      select 'role' as kind, tenant_id, role_code, null::text as permission_code,
        scope_type, legal_entity_id, station_id, expires_at, null::timestamptz as revoked_at
      from app.membership_role_assignments
      where tenant_id = ${tenantId}
        and membership_id = ${row.membership_id}
        and (expires_at is null or expires_at > now())
      union all
      select 'grant' as kind, tenant_id, null::text as role_code, permission_code, scope_type, legal_entity_id, station_id,
             expires_at, revoked_at
      from app.temporary_permission_grants
      where tenant_id = ${tenantId}
        and membership_id = ${row.membership_id}
        and revoked_at is null
        and expires_at > now()
    `)) as unknown as Array<RoleAssignmentRow & TemporaryGrantRow & { kind: 'role' | 'grant' }>;
    const roleRows = assignments.filter((row) => row.kind === 'role');
    const grantRows = assignments.filter((row) => row.kind === 'grant');

    return {
      tenantId: row.tenant_id,
      membershipId: row.membership_id,
      identityId: row.identity_id,
      actorId: row.identity_id,
      status,
      roleAssignments: roleRows.map(roleAssignmentFromRow),
      temporaryGrants: grantRows.map(temporaryGrantFromRow),
    };
  });
}

const membershipRead = Symbol('tenant-membership');
/** Seed only server-loaded authority inside the current read scope. */
export function rememberLoadedMembership(
  record: MembershipRecord,
): Promise<MembershipRecord | null> {
  return memoizeRequestRead(
    membershipRead,
    JSON.stringify([record.identityId, record.tenantId]),
    () => Promise.resolve(record),
  );
}

export const loadTenantMembership: TenantMembershipLoader = (identityId, tenantId) =>
  memoizeRequestRead(membershipRead, JSON.stringify([identityId, tenantId]), () =>
    loadTenantMembershipWithDatabase(identityId, tenantId, getDatabase()),
  );

export function resolveTenantExecutionContext(
  input: Parameters<typeof resolveTenantExecutionContextUncached>[0],
): Promise<TenantExecutionContext> {
  if (input.authenticatedActor || input.resolveActor || input.loadMembership || input.now)
    return resolveTenantExecutionContextUncached(input);
  return reuseRequestAuthority(input.request, input.requestedTenantId, () =>
    resolveTenantExecutionContextUncached(input),
  );
}

async function resolveTenantExecutionContextUncached(input: {
  request: Request;
  requestedTenantId: string;
  authenticatedActor?: AuthenticatedActorContext;
  resolveActor?: AuthenticatedActorResolver;
  loadMembership?: TenantMembershipLoader;
  now?: Date;
}): Promise<TenantExecutionContext> {
  const now = input.now ?? new Date();
  const actor = input.authenticatedActor
    ? input.authenticatedActor
    : await requireAuthenticatedActor(input.request, input.resolveActor, now);
  if (input.authenticatedActor) assertSessionActive(actor.session, now);
  const tenantResult = z.string().uuid().safeParse(input.requestedTenantId);
  if (!tenantResult.success) {
    throw new AppError('FORBIDDEN', 'A valid requested tenant is required');
  }
  const tenantId = tenantResult.data;
  const membership = await (input.loadMembership ?? loadTenantMembership)(
    actor.identityId,
    tenantId,
  );
  if (!membership) {
    throw new AppError('FORBIDDEN', 'The actor has no membership in the requested tenant');
  }

  const binding = {
    tenantId,
    actorId: actor.identityId,
    membershipId: membership.membershipId,
  } as const;
  assertActiveTenantMembership(binding, membership);
  if (membership.identityId !== actor.identityId || membership.tenantId !== tenantId) {
    throw new AppError(
      'FORBIDDEN',
      'The membership identity or tenant does not match the authenticated actor',
    );
  }

  const transaction = createTrustedTenantTransactionContext({
    ...binding,
    requestId: randomUUID(),
  });
  const authorization: AuthorizationActor = {
    userId: actor.identityId,
    membershipId: membership.membershipId,
    tenantId,
    membershipActive: true,
    strongAuthenticationAt: actor.session.strongAuthenticatedAt,
    strongAuthenticationExpiresAt: actor.session.strongAuthenticationExpiresAt,
    strongAuthenticationVerified: actor.session.strongAuthenticationVerified,
    stepUpLevel: actor.session.stepUpLevel,
    stepUpTenantId: actor.session.stepUpTenantId,
    roleAssignments: membership.roleAssignments,
    temporaryGrants: membership.temporaryGrants,
  };

  return { actor, membership, authorization, transaction };
}
