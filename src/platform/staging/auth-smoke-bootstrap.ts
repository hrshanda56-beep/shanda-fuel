import { hashPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { signSecurityEvent, type SignedSecurityEvent } from '../security';

export const STAGING_AUTH_SMOKE_IDS = {
  tenantId: 'a1000000-0000-4000-8000-000000000001',
  actorId: 'a2000000-0000-4000-8000-000000000001',
  membershipId: 'a3000000-0000-4000-8000-000000000001',
  legalEntityId: 'a4000000-0000-4000-8000-000000000001',
  stationId: 'a5000000-0000-4000-8000-000000000001',
} as const;

export const STAGING_AUTH_SMOKE_PERMISSIONS = ['business_day.open', 'shift.start'] as const;

export const STAGING_AUTH_SMOKE_DISPLAY_NAME = 'Shanda Fuel Staging Smoke Operator';
export const STAGING_AUTH_SMOKE_EMAIL_SUFFIX = '@staging.shandafuel.invalid';
export const STAGING_AUTH_SMOKE_TTL_MS = 2 * 60 * 60 * 1000;

type Ids = typeof STAGING_AUTH_SMOKE_IDS;

export type StagingAuthSmokeMode = 'check' | 'bootstrap';

export type StagingAuthSmokeState = {
  now: Date;
  tenant: { id: string; status: string } | null;
  legalEntity: { id: string; tenantId: string; status: string } | null;
  station: { id: string; tenantId: string; legalEntityId: string; status: string } | null;
  membership: { id: string; tenantId: string; identityId: string; status: string } | null;
  user: { id: string; name: string; email: string } | null;
  emailOwnerId: string | null;
  credentialAccounts: Array<{
    id: string;
    accountId: string;
    providerId: string;
    userId: string;
    hasPassword: boolean;
  }>;
  permissionCodes: string[];
  grants: Array<{
    id: string;
    tenantId: string;
    membershipId: string;
    permissionCode: string;
    scopeType: string;
    legalEntityId: string | null;
    stationId: string | null;
    expiresAt: Date;
    revokedAt: Date | null;
  }>;
};

export type StagingAuthSmokeRepository = {
  readState: (ids: Ids, expectedEmail?: string) => Promise<StagingAuthSmokeState>;
  createUser: (input: { id: string; name: string; email: string }) => Promise<void>;
  createCredentialAccount: (input: {
    userId: string;
    accountId: string;
    passwordHash: string;
  }) => Promise<void>;
  createPermissionGrant: (input: {
    tenantId: string;
    membershipId: string;
    permissionCode: (typeof STAGING_AUTH_SMOKE_PERMISSIONS)[number];
    legalEntityId: string;
    stationId: string;
    expiresAt: Date;
    reason: string;
  }) => Promise<void>;
  appendSecurityEvent: (event: SignedSecurityEvent) => Promise<void>;
};

export type StagingAuthSmokeResult = {
  mode: StagingAuthSmokeMode;
  hierarchyValid: boolean;
  membershipValid: boolean;
  authUser: 'present' | 'created' | 'absent';
  credentialAccount: 'present' | 'created' | 'absent';
  permissionGrants: Record<string, 'present' | 'created' | 'expired' | 'absent'>;
  expiresAt?: Date;
};

export class StagingAuthSmokeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StagingAuthSmokeError';
  }
}

function isSyntheticEmail(email: string): boolean {
  return /^[a-z0-9][a-z0-9+._-]*@staging\.shandafuel\.invalid$/i.test(email);
}

export function assertSyntheticEmail(email: string): void {
  if (!isSyntheticEmail(email)) {
    throw new StagingAuthSmokeError(
      `The operator email must use the reserved ${STAGING_AUTH_SMOKE_EMAIL_SUFFIX} domain`,
    );
  }
}

export function assertExactSyntheticIds<T extends Record<keyof Ids, string>>(
  ids: T,
): asserts ids is T & Ids {
  for (const [key, expected] of Object.entries(STAGING_AUTH_SMOKE_IDS)) {
    const received = ids[key as keyof Ids];
    if (received !== expected) {
      throw new StagingAuthSmokeError(`Refusing non-synthetic ${key}`);
    }
  }
}

function fail(message: string): never {
  throw new StagingAuthSmokeError(message);
}

function validateState(
  state: StagingAuthSmokeState,
  ids: Ids,
  expectedEmail: string | undefined,
): void {
  if (!state.tenant || state.tenant.id !== ids.tenantId || state.tenant.status !== 'ACTIVE') {
    fail('Synthetic Tenant A is missing or not active');
  }
  if (
    !state.legalEntity ||
    state.legalEntity.id !== ids.legalEntityId ||
    state.legalEntity.tenantId !== ids.tenantId ||
    state.legalEntity.status !== 'ACTIVE'
  ) {
    fail('Synthetic Legal Entity A is missing, inactive, or bound to the wrong tenant');
  }
  if (
    !state.station ||
    state.station.id !== ids.stationId ||
    state.station.tenantId !== ids.tenantId ||
    state.station.legalEntityId !== ids.legalEntityId ||
    state.station.status !== 'ACTIVE'
  ) {
    fail('Synthetic Station A is missing, inactive, or bound to the wrong hierarchy');
  }
  if (
    !state.membership ||
    state.membership.id !== ids.membershipId ||
    state.membership.tenantId !== ids.tenantId ||
    state.membership.identityId !== ids.actorId ||
    state.membership.status !== 'ACTIVE'
  ) {
    fail('Synthetic Membership A is missing, inactive, or incorrectly bound');
  }

  if (expectedEmail && state.emailOwnerId && state.emailOwnerId !== ids.actorId) {
    fail('The requested synthetic email belongs to a different identity');
  }
  if (!state.user && state.emailOwnerId) {
    fail('The requested synthetic email has an inconsistent auth identity row');
  }

  if (state.user) {
    if (state.user.id !== ids.actorId || !isSyntheticEmail(state.user.email)) {
      fail('Existing auth user is not the expected synthetic staging identity');
    }
    if (expectedEmail && state.user.email !== expectedEmail) {
      fail('Existing auth user email does not match the requested synthetic email');
    }
    if (state.user.name !== STAGING_AUTH_SMOKE_DISPLAY_NAME) {
      fail('Existing auth user display name does not match the synthetic identity');
    }
  } else if (state.credentialAccounts.length > 0) {
    fail('Credential accounts exist without the expected auth user');
  }

  const credentialAccounts = state.credentialAccounts.filter(
    (account) => account.providerId === 'credential',
  );
  if (credentialAccounts.length > 1) {
    fail('Multiple credential accounts exist for the synthetic auth user');
  }
  const credentialAccount = credentialAccounts[0];
  if (
    credentialAccount &&
    (credentialAccount.userId !== ids.actorId || credentialAccount.accountId !== ids.actorId)
  ) {
    fail('Existing credential account is not linked to the synthetic auth user');
  }
  if (credentialAccount && !credentialAccount.hasPassword) {
    fail('Existing credential account has no password hash');
  }

  const requiredPermissions = new Set(STAGING_AUTH_SMOKE_PERMISSIONS);
  for (const permissionCode of STAGING_AUTH_SMOKE_PERMISSIONS) {
    if (!state.permissionCodes.includes(permissionCode)) {
      fail(`Required permission definition is missing: ${permissionCode}`);
    }
  }
  for (const grant of state.grants) {
    if (
      !requiredPermissions.has(
        grant.permissionCode as (typeof STAGING_AUTH_SMOKE_PERMISSIONS)[number],
      )
    ) {
      continue;
    }
    if (
      grant.tenantId !== ids.tenantId ||
      grant.membershipId !== ids.membershipId ||
      grant.scopeType !== 'STATION' ||
      grant.legalEntityId !== ids.legalEntityId ||
      grant.stationId !== ids.stationId
    ) {
      fail(`Existing ${grant.permissionCode} grant is outside Station A`);
    }
    if (
      grant.revokedAt === null &&
      grant.expiresAt.getTime() > state.now.getTime() + STAGING_AUTH_SMOKE_TTL_MS
    ) {
      fail(`Existing ${grant.permissionCode} grant exceeds the two-hour staging limit`);
    }
  }
}

function activeGrant(
  state: StagingAuthSmokeState,
  permissionCode: (typeof STAGING_AUTH_SMOKE_PERMISSIONS)[number],
): StagingAuthSmokeState['grants'][number] | undefined {
  return state.grants.find(
    (grant) =>
      grant.permissionCode === permissionCode &&
      grant.revokedAt === null &&
      grant.expiresAt.getTime() > state.now.getTime(),
  );
}

export async function runStagingAuthSmokeBootstrap(input: {
  repository: StagingAuthSmokeRepository;
  ids: Ids;
  mode: StagingAuthSmokeMode;
  email?: string;
  password?: string;
  auditKey?: { keyId: string; secret: string };
  requestId?: string;
}): Promise<StagingAuthSmokeResult> {
  assertExactSyntheticIds(input.ids);
  if (input.email) assertSyntheticEmail(input.email);
  if (input.mode === 'bootstrap' && !input.email) {
    fail('Bootstrap requires an explicit synthetic staging email');
  }
  if (input.mode === 'bootstrap' && !input.password) {
    fail('Bootstrap requires a runtime-supplied password');
  }
  if (input.mode === 'bootstrap' && !input.auditKey?.keyId) {
    fail('Bootstrap requires an audit signing key');
  }

  const state = await input.repository.readState(input.ids, input.email);
  validateState(state, input.ids, input.email);

  const credentialAccount = state.credentialAccounts.find(
    (account) => account.providerId === 'credential',
  );
  const result: StagingAuthSmokeResult = {
    mode: input.mode,
    hierarchyValid: true,
    membershipValid: true,
    authUser: state.user ? 'present' : 'absent',
    credentialAccount: credentialAccount ? 'present' : 'absent',
    permissionGrants: Object.fromEntries(
      STAGING_AUTH_SMOKE_PERMISSIONS.map((permissionCode) => {
        const grant = activeGrant(state, permissionCode);
        return [
          permissionCode,
          grant
            ? grant.expiresAt.getTime() > state.now.getTime() + STAGING_AUTH_SMOKE_TTL_MS
              ? 'expired'
              : 'present'
            : state.grants.some(
                  (candidate) =>
                    candidate.permissionCode === permissionCode && candidate.revokedAt === null,
                )
              ? 'expired'
              : 'absent',
        ];
      }),
    ) as StagingAuthSmokeResult['permissionGrants'],
  };

  if (input.mode === 'check') return result;

  const expiresAt = new Date(state.now.getTime() + STAGING_AUTH_SMOKE_TTL_MS);
  let passwordHash: string | undefined;
  if (!credentialAccount) passwordHash = await hashPassword(input.password!);

  if (!state.user) {
    await input.repository.createUser({
      id: input.ids.actorId,
      name: STAGING_AUTH_SMOKE_DISPLAY_NAME,
      email: input.email!,
    });
    result.authUser = 'created';
  }
  if (!credentialAccount) {
    await input.repository.createCredentialAccount({
      userId: input.ids.actorId,
      accountId: input.ids.actorId,
      passwordHash: passwordHash!,
    });
    result.credentialAccount = 'created';
  }

  const createdPermissions: string[] = [];
  for (const permissionCode of STAGING_AUTH_SMOKE_PERMISSIONS) {
    if (activeGrant(state, permissionCode)) continue;
    await input.repository.createPermissionGrant({
      tenantId: input.ids.tenantId,
      membershipId: input.ids.membershipId,
      permissionCode,
      legalEntityId: input.ids.legalEntityId,
      stationId: input.ids.stationId,
      expiresAt,
      reason: 'A3 authenticated staging smoke bootstrap; expires automatically',
    });
    result.permissionGrants[permissionCode] = 'created';
    createdPermissions.push(permissionCode);
  }

  const event = signSecurityEvent(
    {
      eventId: randomUUID(),
      tenantId: input.ids.tenantId,
      eventCode: 'staging.auth_smoke.bootstrap',
      requestId: input.requestId ?? randomUUID(),
      occurredAt: state.now.toISOString(),
      details: {
        actorType: 'SUPPORT',
        initiatedBy: 'staging-auth-smoke-bootstrap',
        subjectType: 'auth.user',
        subjectId: input.ids.actorId,
        stationId: input.ids.stationId,
        permissions: createdPermissions,
        expiresAt: expiresAt.toISOString(),
      },
    },
    input.auditKey!,
  );
  await input.repository.appendSecurityEvent(event);
  result.expiresAt = expiresAt;
  return result;
}

type Row = Record<string, unknown>;

function one<T extends Row>(rows: T[]): T | null {
  return rows[0] ?? null;
}

export function createSqlStagingAuthSmokeRepository(
  query: Sql | TransactionSql,
): StagingAuthSmokeRepository {
  return {
    async readState(ids, expectedEmail) {
      const [
        nowRows,
        tenantRows,
        legalEntityRows,
        stationRows,
        membershipRows,
        userRows,
        accountRows,
        permissionRows,
        grantRows,
        emailRows,
      ] = await Promise.all([
        query<{ now: Date }[]>`select now() as now`,
        query<
          { id: string; status: string }[]
        >`select id, status from app.tenants where id = ${ids.tenantId}`,
        query<
          { id: string; tenant_id: string; status: string }[]
        >`select id, tenant_id, status from app.legal_entities where id = ${ids.legalEntityId}`,
        query<
          { id: string; tenant_id: string; legal_entity_id: string; status: string }[]
        >`select id, tenant_id, legal_entity_id, status from app.stations where id = ${ids.stationId}`,
        query<
          { id: string; tenant_id: string; identity_id: string; status: string }[]
        >`select id, tenant_id, identity_id, status from app.memberships where id = ${ids.membershipId}`,
        query<
          { id: string; name: string; email: string }[]
        >`select id, name, email from auth."user" where id = ${ids.actorId}`,
        query<
          {
            id: string;
            account_id: string;
            provider_id: string;
            user_id: string;
            password: string | null;
          }[]
        >`select id, account_id, provider_id, user_id, password from auth.account where user_id = ${ids.actorId}`,
        query<
          { code: string }[]
        >`select code from platform.permission_definitions where code = any(${STAGING_AUTH_SMOKE_PERMISSIONS})`,
        query<
          {
            id: string;
            tenant_id: string;
            membership_id: string;
            permission_code: string;
            scope_type: string;
            legal_entity_id: string | null;
            station_id: string | null;
            expires_at: Date;
            revoked_at: Date | null;
          }[]
        >`select id, tenant_id, membership_id, permission_code, scope_type, legal_entity_id, station_id, expires_at, revoked_at from app.temporary_permission_grants where membership_id = ${ids.membershipId} and permission_code = any(${STAGING_AUTH_SMOKE_PERMISSIONS})`,
        expectedEmail
          ? query<{ id: string }[]>`select id from auth."user" where email = ${expectedEmail}`
          : Promise.resolve([]),
      ]);

      return {
        now: one(nowRows)!.now,
        tenant: one(tenantRows),
        legalEntity: one(legalEntityRows)
          ? {
              id: one(legalEntityRows)!.id,
              tenantId: one(legalEntityRows)!.tenant_id,
              status: one(legalEntityRows)!.status,
            }
          : null,
        station: one(stationRows)
          ? {
              id: one(stationRows)!.id,
              tenantId: one(stationRows)!.tenant_id,
              legalEntityId: one(stationRows)!.legal_entity_id,
              status: one(stationRows)!.status,
            }
          : null,
        membership: one(membershipRows)
          ? {
              id: one(membershipRows)!.id,
              tenantId: one(membershipRows)!.tenant_id,
              identityId: one(membershipRows)!.identity_id,
              status: one(membershipRows)!.status,
            }
          : null,
        user: one(userRows),
        emailOwnerId: one(emailRows)?.id ?? null,
        credentialAccounts: accountRows.map((row) => ({
          id: row.id,
          accountId: row.account_id,
          providerId: row.provider_id,
          userId: row.user_id,
          hasPassword: Boolean(row.password),
        })),
        permissionCodes: permissionRows.map((row) => row.code),
        grants: grantRows.map((row) => ({
          id: row.id,
          tenantId: row.tenant_id,
          membershipId: row.membership_id,
          permissionCode: row.permission_code,
          scopeType: row.scope_type,
          legalEntityId: row.legal_entity_id,
          stationId: row.station_id,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
        })),
      };
    },
    async createUser(input) {
      await query`insert into auth."user" (id, name, email, email_verified) values (${input.id}, ${input.name}, ${input.email}, false)`;
    },
    async createCredentialAccount(input) {
      await query`insert into auth.account (account_id, provider_id, user_id, password) values (${input.accountId}, 'credential', ${input.userId}, ${input.passwordHash})`;
    },
    async createPermissionGrant(input) {
      await query`insert into app.temporary_permission_grants (tenant_id, membership_id, permission_code, scope_type, legal_entity_id, station_id, expires_at, reason) values (${input.tenantId}, ${input.membershipId}, ${input.permissionCode}, 'STATION', ${input.legalEntityId}, ${input.stationId}, ${input.expiresAt}, ${input.reason})`;
    },
    async appendSecurityEvent(event) {
      await query`insert into platform.security_events (id, tenant_id, membership_id, actor_id, event_code, request_id, occurred_at, details, key_id, algorithm, signature) values (${event.eventId}, ${event.tenantId}, ${event.membershipId ?? null}, ${event.actorId ?? null}, ${event.eventCode}, ${event.requestId}, ${event.occurredAt}, ${JSON.stringify(event.details)}::jsonb, ${event.keyId}, ${event.algorithm}, ${event.signature})`;
    },
  };
}
