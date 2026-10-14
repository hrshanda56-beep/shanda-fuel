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

function roleAssignmentFromRow(row: RoleAssignmentRow): RoleAssignment {
  return {
    ...scopeFromRow(row),
    roleCode: roleCodeSchema.parse(row.role_code),
    ...(row.expires_at ? { expiresAt: new Date(row.expires_at) } : {}),
  };
}

function temporaryGrantFromRow(row: TemporaryGrantRow): TemporaryPermissionGrant {
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
    const roleRows = (await transaction.execute(sql`
      select tenant_id, role_code, scope_type, legal_entity_id, station_id, expires_at
      from app.membership_role_assignments
      where tenant_id = ${tenantId}
        and membership_id = ${row.membership_id}
        and (expires_at is null or expires_at > now())
    `)) as unknown as RoleAssignmentRow[];
    const grantRows = (await transaction.execute(sql`
      select tenant_id, permission_code, scope_type, legal_entity_id, station_id,
             expires_at, revoked_at
      from app.temporary_permission_grants
      where tenant_id = ${tenantId}
        and membership_id = ${row.membership_id}
        and revoked_at is null
        and expires_at > now()
    `)) as unknown as TemporaryGrantRow[];

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

export const loadTenantMembership: TenantMembershipLoader = (identityId, tenantId) =>
  loadTenantMembershipWithDatabase(identityId, tenantId, getDatabase());

export async function resolveTenantExecutionContext(input: {
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
