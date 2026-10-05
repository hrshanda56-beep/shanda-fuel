import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

import {
  ACCEPTED_PROVIDER_MEMBERSHIP,
  DuplicateProvisioningError,
  ACCEPTED_PROVISIONING_DB_ROLE,
  PROVISIONING_REASON,
  ProvisioningError,
  READ_ONLY_GRANT_PLAN,
  ScopeValidationError,
  assertAcceptedProvisioningRole,
  formatSafeError,
  parseCli,
  provisioningReason,
  readHiddenPassword,
  scopeForGrant,
  type IdentitySnapshot,
  type DatabaseRoleSnapshot,
  type ProvisioningRepository,
  type ScopeIds,
  type ScopeSnapshot,
  type TemporaryGrantSnapshot,
  preparePlan,
  provisionFirstUser,
  revokeFirstUserAccess,
} from '../../../scripts/first-user-provisioning';

const scopeIds: ScopeIds = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  legalEntityId: '00000000-0000-4000-8000-000000000002',
  stationId: '00000000-0000-4000-8000-000000000003',
};

const scope: ScopeSnapshot = {
  tenant: { id: scopeIds.tenantId, name: 'Shanda Fuel', status: 'ACTIVE' },
  legalEntity: {
    id: scopeIds.legalEntityId,
    tenantId: scopeIds.tenantId,
    name: 'Shanda Fuel Operations',
    status: 'ACTIVE',
  },
  station: {
    id: scopeIds.stationId,
    tenantId: scopeIds.tenantId,
    legalEntityId: scopeIds.legalEntityId,
    code: 'TEST-001',
    name: 'Test Station',
    status: 'ACTIVE',
  },
};

const auditKey = { keyId: 'test-key', secret: 'test-secret' };
const expiry = new Date('2026-10-04T11:00:00.000Z');

class FakeRepository implements ProvisioningRepository {
  readonly nowValue = new Date('2026-10-04T10:00:00.000Z');
  readonly writes = {
    users: [] as string[],
    accounts: [] as string[],
    memberships: [] as string[],
    grants: [] as string[],
    events: [] as string[],
    contexts: [] as string[],
    revokedGrants: [] as string[],
    revokedSessions: [] as string[],
    disabledMemberships: [] as string[],
  };
  availablePermissions = READ_ONLY_GRANT_PLAN.map((grant) => grant.permissionCode);
  existing: IdentitySnapshot | null = null;
  currentScope = scope;
  failOnGrant = false;
  unrevokedGrants: TemporaryGrantSnapshot[] = [];

  async now(): Promise<Date> {
    return this.nowValue;
  }

  async lockEmail(): Promise<void> {}

  async loadScope(): Promise<ScopeSnapshot> {
    return this.currentScope;
  }

  async findIdentityByEmail(): Promise<IdentitySnapshot | null> {
    return this.existing;
  }

  async listPermissionDefinitions(): Promise<readonly string[]> {
    return this.availablePermissions;
  }

  async setTenantContext(
    context: ScopeIds & { actorId: string; membershipId: string },
  ): Promise<void> {
    this.writes.contexts.push(`${context.actorId}:${context.membershipId}`);
  }

  async insertUser(input: { id: string }): Promise<void> {
    this.writes.users.push(input.id);
  }

  async insertCredentialAccount(input: { userId: string }): Promise<void> {
    this.writes.accounts.push(input.userId);
  }

  async insertMembership(input: { id: string }): Promise<void> {
    this.writes.memberships.push(input.id);
  }

  async insertGrant(input: {
    tenantId: string;
    membershipId: string;
    permissionCode: string;
    scopeType: 'TENANT' | 'LEGAL_ENTITY' | 'STATION';
    legalEntityId?: string;
    stationId?: string;
    reason: string;
  }): Promise<void> {
    if (this.failOnGrant && this.writes.grants.length === 1) {
      throw new Error('simulated grant failure');
    }
    this.writes.grants.push(`${input.permissionCode}:${input.scopeType}`);
    const id = `00000000-0000-4000-8000-${String(100 + this.unrevokedGrants.length).padStart(12, '0')}`;
    this.unrevokedGrants.push({
      id,
      tenantId: input.tenantId,
      membershipId: input.membershipId,
      permissionCode: input.permissionCode,
      scopeType: input.scopeType,
      legalEntityId: input.legalEntityId ?? null,
      stationId: input.stationId ?? null,
      reason: input.reason,
    });
  }

  async appendAuditEvent(event: { eventId: string }): Promise<void> {
    this.writes.events.push(event.eventId);
  }

  async listUnrevokedTemporaryGrants(): Promise<readonly TemporaryGrantSnapshot[]> {
    return this.unrevokedGrants;
  }

  async revokeTemporaryGrants(input: {
    grantIds: readonly string[];
    reason: string;
  }): Promise<number> {
    expect(input.reason.startsWith(`${PROVISIONING_REASON}:`)).toBe(true);
    const ids = new Set(input.grantIds);
    const before = this.unrevokedGrants.length;
    this.unrevokedGrants = this.unrevokedGrants.filter((grant) => {
      if (!ids.has(grant.id)) return true;
      this.writes.revokedGrants.push(grant.id);
      return false;
    });
    return before - this.unrevokedGrants.length;
  }

  async revokeSessions(userId: string): Promise<number> {
    this.writes.revokedSessions.push(userId);
    return 1;
  }

  async disableMembership(input: { membershipId: string }): Promise<boolean> {
    this.writes.disabledMemberships.push(input.membershipId);
    if (this.existing) {
      this.existing = {
        ...this.existing,
        memberships: this.existing.memberships.map((membership) =>
          membership.id === input.membershipId ? { ...membership, status: 'DISABLED' } : membership,
        ),
      };
    }
    return true;
  }

  snapshot() {
    return {
      writes: Object.fromEntries(
        Object.entries(this.writes).map(([key, value]) => [key, [...value]]),
      ) as typeof this.writes,
      unrevokedGrants: [...this.unrevokedGrants],
    };
  }

  restore(snapshot: ReturnType<FakeRepository['snapshot']>): void {
    for (const [key, value] of Object.entries(snapshot.writes) as [
      keyof typeof this.writes,
      string[],
    ][]) {
      this.writes[key].splice(0, this.writes[key].length, ...value);
    }
    this.unrevokedGrants = [...snapshot.unrevokedGrants];
  }
}

function request() {
  return {
    email: 'Owner@Example.com',
    displayName: 'First Production Owner',
    scope: scopeIds,
    expiresAt: expiry,
  };
}

function existingIdentity(status: string = 'ACTIVE'): IdentitySnapshot {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    name: 'First Production Owner',
    email: 'owner@example.com',
    accounts: [],
    memberships: [
      {
        id: '00000000-0000-4000-8000-000000000011',
        tenantId: scopeIds.tenantId,
        identityId: '00000000-0000-4000-8000-000000000010',
        status,
        roleAssignmentCount: 0,
      },
    ],
  };
}

const temporaryUserId = '00000000-0000-4000-8000-000000000010';
const temporaryOperationId = '00000000-0000-4000-8000-000000000020';

function acceptedRoleSnapshot(overrides: Partial<DatabaseRoleSnapshot> = {}): DatabaseRoleSnapshot {
  return {
    currentUser: ACCEPTED_PROVISIONING_DB_ROLE,
    rolcanlogin: true,
    rolsuper: false,
    rolbypassrls: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolinherit: false,
    rolreplication: false,
    rolconfig: null,
    memberships: [
      {
        grantedRole: ACCEPTED_PROVIDER_MEMBERSHIP.grantedRole,
        member: ACCEPTED_PROVIDER_MEMBERSHIP.member,
        grantor: ACCEPTED_PROVIDER_MEMBERSHIP.grantor,
        adminOption: ACCEPTED_PROVIDER_MEMBERSHIP.adminOption,
        inheritOption: ACCEPTED_PROVIDER_MEMBERSHIP.inheritOption,
        setOption: ACCEPTED_PROVIDER_MEMBERSHIP.setOption,
      },
    ],
    memberCapability: true,
    usageCapability: false,
    setCapability: false,
    adminCapability: true,
    databaseOwner: false,
    schemaOwner: false,
    applicationTableOwner: false,
    unexpectedDirectTablePrivileges: false,
    unexpectedFunctionPrivileges: false,
    missingExpectedFunctionPrivileges: false,
    ...overrides,
  };
}

function seedProvisionedGrants(
  repository: FakeRepository,
  operationId = temporaryOperationId,
): void {
  for (const grant of READ_ONLY_GRANT_PLAN) {
    const grantScope = scopeForGrant(grant, scopeIds);
    repository.unrevokedGrants.push({
      id: `00000000-0000-4000-8000-${String(200 + repository.unrevokedGrants.length).padStart(12, '0')}`,
      tenantId: scopeIds.tenantId,
      membershipId: '00000000-0000-4000-8000-000000000011',
      permissionCode: grant.permissionCode,
      scopeType: grantScope.scopeType,
      legalEntityId: grantScope.legalEntityId ?? null,
      stationId: grantScope.stationId ?? null,
      reason: provisioningReason(operationId),
    });
  }
}

async function runWithRollback<T>(
  repository: FakeRepository,
  operation: () => Promise<T>,
): Promise<T> {
  const snapshot = repository.snapshot();
  try {
    return await operation();
  } catch (error) {
    repository.restore(snapshot);
    throw error;
  }
}

describe('first production user provisioning', () => {
  it('creates only the explicit read-only grant plan and never exposes the password in audit data', async () => {
    const repository = new FakeRepository();
    const password = 'a test password that is never logged';
    let hashedInput = '';

    const result = await provisionFirstUser({
      repository,
      request: request(),
      password,
      auditKey,
      hasher: async (value) => {
        hashedInput = value;
        return 'better-auth-password-hash';
      },
    });

    expect(hashedInput).toBe(password);
    expect(result.permissionCodes).toEqual(
      READ_ONLY_GRANT_PLAN.map((grant) => grant.permissionCode),
    );
    expect(repository.writes.grants).toEqual(
      READ_ONLY_GRANT_PLAN.map((grant) => `${grant.permissionCode}:${grant.scopeType}`),
    );
    expect(repository.writes.grants).toHaveLength(READ_ONLY_GRANT_PLAN.length);
    expect(repository.writes.events).toHaveLength(2);
    expect(JSON.stringify(repository.writes)).not.toContain(password);
    expect(
      READ_ONLY_GRANT_PLAN.every(
        (grant) =>
          grant.permissionCode.endsWith('.view') ||
          grant.permissionCode.endsWith('.review') ||
          grant.permissionCode === 'tenant.context.select',
      ),
    ).toBe(true);
    expect(
      READ_ONLY_GRANT_PLAN.some(
        (grant) =>
          grant.permissionCode.includes('.manage') || grant.permissionCode.includes('.post'),
      ),
    ).toBe(false);
  });

  it('refuses duplicate identity creation before any writes', async () => {
    const repository = new FakeRepository();
    repository.existing = existingIdentity();

    await expect(
      provisionFirstUser({ repository, request: request(), password: 'a test password', auditKey }),
    ).rejects.toBeInstanceOf(DuplicateProvisioningError);
    expect(repository.writes.users).toHaveLength(0);
    expect(repository.writes.accounts).toHaveLength(0);
    expect(repository.writes.memberships).toHaveLength(0);
    expect(repository.writes.grants).toHaveLength(0);
  });

  it('refuses a cross-tenant legal-entity or station relationship', async () => {
    const repository = new FakeRepository();
    repository.currentScope = {
      ...scope,
      station: { ...scope.station, legalEntityId: '00000000-0000-4000-8000-000000000099' },
    };

    await expect(preparePlan(repository, request())).rejects.toBeInstanceOf(ScopeValidationError);
    expect(repository.writes.users).toHaveLength(0);
    expect(repository.writes.grants).toHaveLength(0);
  });

  it('can be wrapped in one transaction and leaves no partial writes after a grant failure', async () => {
    const repository = new FakeRepository();
    repository.failOnGrant = true;

    await expect(
      runWithRollback(repository, () =>
        provisionFirstUser({
          repository,
          request: request(),
          password: 'a test password',
          auditKey,
          hasher: async () => 'hash',
        }),
      ),
    ).rejects.toThrow('simulated grant failure');
    expect(repository.writes.users).toHaveLength(0);
    expect(repository.writes.accounts).toHaveLength(0);
    expect(repository.writes.memberships).toHaveLength(0);
    expect(repository.writes.grants).toHaveLength(0);
    expect(repository.writes.events).toHaveLength(0);
  });

  it('dry-run planning performs no writes and still validates the exact permission set', async () => {
    const repository = new FakeRepository();
    const plan = await preparePlan(repository, request());

    expect(plan.grants).toEqual(READ_ONLY_GRANT_PLAN);
    expect(repository.writes.users).toHaveLength(0);
    expect(repository.writes.accounts).toHaveLength(0);
    expect(repository.writes.memberships).toHaveLength(0);
    expect(repository.writes.grants).toHaveLength(0);
    expect(repository.writes.events).toHaveLength(0);
  });

  it('cleanup revokes only the named temporary access and is safe to repeat', async () => {
    const repository = new FakeRepository();
    repository.existing = existingIdentity();
    seedProvisionedGrants(repository);

    const first = await revokeFirstUserAccess({
      repository,
      email: 'OWNER@example.com',
      userId: temporaryUserId,
      operationId: temporaryOperationId,
      scope: scopeIds,
      auditKey,
    });
    const second = await revokeFirstUserAccess({
      repository,
      email: 'owner@example.com',
      userId: temporaryUserId,
      operationId: temporaryOperationId,
      scope: scopeIds,
      auditKey,
    });

    expect(first).toMatchObject({
      revokedGrantCount: READ_ONLY_GRANT_PLAN.length,
      revokedSessionCount: 1,
      membershipDisabled: true,
    });
    expect(second).toEqual({ status: 'already-disabled' });
    expect(repository.writes.revokedGrants).toHaveLength(READ_ONLY_GRANT_PLAN.length);
    expect(repository.writes.revokedSessions).toHaveLength(1);
    expect(repository.writes.disabledMemberships).toHaveLength(1);
    expect(repository.writes.events).toHaveLength(1);
    expect(repository.unrevokedGrants).toHaveLength(0);
  });

  it('refuses cleanup when unrelated active temporary access would be revoked by membership disablement', async () => {
    const repository = new FakeRepository();
    repository.existing = existingIdentity();
    seedProvisionedGrants(repository);
    repository.unrevokedGrants.push({
      id: '00000000-0000-4000-8000-000000000099',
      tenantId: scopeIds.tenantId,
      membershipId: '00000000-0000-4000-8000-000000000011',
      permissionCode: 'tenant.view',
      scopeType: 'TENANT',
      legalEntityId: null,
      stationId: null,
      reason: 'unrelated-operation:00000000-0000-4000-8000-000000000030',
    });

    await expect(
      revokeFirstUserAccess({
        repository,
        email: 'owner@example.com',
        userId: temporaryUserId,
        operationId: temporaryOperationId,
        scope: scopeIds,
        auditKey,
      }),
    ).rejects.toThrow('unrelated unrevoked temporary grants');
    expect(repository.writes.revokedGrants).toHaveLength(0);
    expect(repository.writes.disabledMemberships).toHaveLength(0);
  });

  it('rejects additional memberships so session cleanup cannot affect another access context', async () => {
    const repository = new FakeRepository();
    repository.existing = {
      ...existingIdentity(),
      memberships: [
        ...existingIdentity().memberships,
        {
          id: '00000000-0000-4000-8000-000000000012',
          tenantId: '00000000-0000-4000-8000-000000000099',
          identityId: temporaryUserId,
          status: 'ACTIVE',
          roleAssignmentCount: 0,
        },
      ],
    };
    seedProvisionedGrants(repository);

    await expect(
      revokeFirstUserAccess({
        repository,
        email: 'owner@example.com',
        userId: temporaryUserId,
        operationId: temporaryOperationId,
        scope: scopeIds,
        auditKey,
      }),
    ).rejects.toThrow('memberships outside');
    expect(repository.writes.revokedSessions).toHaveLength(0);
    expect(repository.writes.revokedGrants).toHaveLength(0);
  });

  it('accepts the exact provider membership and effective capability contract', () => {
    expect(() => assertAcceptedProvisioningRole(acceptedRoleSnapshot())).not.toThrow();
  });

  it('fails closed for unsafe or unapproved database roles', () => {
    expect(() => assertAcceptedProvisioningRole(acceptedRoleSnapshot({ rolsuper: true }))).toThrow(
      'non-superuser',
    );
    expect(() =>
      assertAcceptedProvisioningRole(acceptedRoleSnapshot({ rolbypassrls: true })),
    ).toThrow('non-superuser');
    expect(() =>
      assertAcceptedProvisioningRole(acceptedRoleSnapshot({ currentUser: 'app_runtime' })),
    ).toThrow(ACCEPTED_PROVISIONING_DB_ROLE);
  });

  it.each([
    ['wrong granted role', { grantedRole: 'unexpected_role' }],
    ['wrong member', { member: 'unexpected_member' }],
    ['wrong grantor', { grantor: 'unexpected_grantor' }],
    ['ADMIN=false', { adminOption: false }],
    ['INHERIT=true', { inheritOption: true }],
    ['SET=true', { setOption: true }],
  ])('rejects provider membership drift: %s', (_label, change) => {
    expect(() =>
      assertAcceptedProvisioningRole(
        acceptedRoleSnapshot({
          memberships: [{ ...acceptedRoleSnapshot().memberships[0]!, ...change }],
        }),
      ),
    ).toThrow('exact approved provider relationship');
  });

  it('rejects additional, reverse, and unrelated memberships', () => {
    const exact = acceptedRoleSnapshot().memberships[0]!;
    expect(() =>
      assertAcceptedProvisioningRole(
        acceptedRoleSnapshot({
          memberships: [exact, { ...exact, member: 'another_role' }],
        }),
      ),
    ).toThrow('exact approved provider relationship');
    expect(() =>
      assertAcceptedProvisioningRole(
        acceptedRoleSnapshot({
          memberships: [
            { ...exact, grantedRole: 'another_role', member: ACCEPTED_PROVISIONING_DB_ROLE },
          ],
        }),
      ),
    ).toThrow('exact approved provider relationship');
    expect(() =>
      assertAcceptedProvisioningRole(
        acceptedRoleSnapshot({
          memberships: [exact, { ...exact, member: 'unrelated_role' }],
        }),
      ),
    ).toThrow('exact approved provider relationship');
  });

  it('accepts MEMBER=true only with USAGE=false, SET=false, and ADMIN=true', () => {
    expect(() =>
      assertAcceptedProvisioningRole(acceptedRoleSnapshot({ memberCapability: true })),
    ).not.toThrow();
    expect(() =>
      assertAcceptedProvisioningRole(acceptedRoleSnapshot({ memberCapability: false })),
    ).toThrow('effective membership capabilities');
    expect(() =>
      assertAcceptedProvisioningRole(acceptedRoleSnapshot({ usageCapability: true })),
    ).toThrow('effective membership capabilities');
    expect(() =>
      assertAcceptedProvisioningRole(acceptedRoleSnapshot({ setCapability: true })),
    ).toThrow('effective membership capabilities');
    expect(() =>
      assertAcceptedProvisioningRole(acceptedRoleSnapshot({ adminCapability: false })),
    ).toThrow('effective membership capabilities');
  });

  it('rejects role configuration, ownership, table, and function privilege drift', () => {
    expect(() =>
      assertAcceptedProvisioningRole(acceptedRoleSnapshot({ rolconfig: ['search_path=public'] })),
    ).toThrow('role configuration');
    expect(() =>
      assertAcceptedProvisioningRole(acceptedRoleSnapshot({ databaseOwner: true })),
    ).toThrow('ownership');
    expect(() =>
      assertAcceptedProvisioningRole(acceptedRoleSnapshot({ schemaOwner: true })),
    ).toThrow('ownership');
    expect(() =>
      assertAcceptedProvisioningRole(acceptedRoleSnapshot({ applicationTableOwner: true })),
    ).toThrow('ownership');
    expect(() =>
      assertAcceptedProvisioningRole(
        acceptedRoleSnapshot({ unexpectedDirectTablePrivileges: true }),
      ),
    ).toThrow('direct table privilege');
    expect(() =>
      assertAcceptedProvisioningRole(acceptedRoleSnapshot({ unexpectedFunctionPrivileges: true })),
    ).toThrow('function privilege');
    expect(() =>
      assertAcceptedProvisioningRole(
        acceptedRoleSnapshot({ missingExpectedFunctionPrivileges: true }),
      ),
    ).toThrow('function privilege');
  });

  it('reads a password with raw TTY input without echoing it', async () => {
    class FakeInput extends EventEmitter {
      isTTY = true;
      rawMode = false;
      paused = false;

      setRawMode(mode: boolean): void {
        this.rawMode = mode;
      }

      resume(): void {}

      pause(): void {
        this.paused = true;
      }
    }
    class FakeOutput {
      isTTY = true;
      chunks: string[] = [];

      write(chunk: string | Uint8Array): boolean {
        this.chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
        return true;
      }
    }

    const input = new FakeInput();
    const output = new FakeOutput();
    const passwordPromise = readHiddenPassword(input as never, output as never);
    input.emit('data', Buffer.from('a secret password\r\n'));
    const password = await passwordPromise;

    expect(password).toBe('a secret password');
    expect(output.chunks.join('')).toBe('Password (hidden): \n');
    expect(output.chunks.join('')).not.toContain(password);
    expect(input.rawMode).toBe(false);
    expect(input.paused).toBe(true);
  });

  it('fails closed without a TTY and redacts non-tool errors', () => {
    expect(() => readHiddenPassword({ isTTY: false } as never, { isTTY: false } as never)).toThrow(
      'interactive local TTY',
    );
    expect(formatSafeError(new Error('postgres://user:secret@example/db'))).not.toContain('secret');
    expect(formatSafeError(new Error('postgres://user:secret@example/db'))).toContain(
      'Provisioning tool failed',
    );
    expect(formatSafeError(new ProvisioningError('safe validation failure'))).toBe(
      'safe validation failure',
    );
  });

  it('requires explicit confirmation and never reflects a secret-looking argv token', () => {
    expect(() =>
      parseCli([
        '--provision',
        '--environment',
        'production',
        '--email',
        'owner@example.com',
        '--display-name',
        'Owner',
        '--expires-at',
        expiry.toISOString(),
      ]),
    ).toThrow('confirm-production-provisioning');
    expect(() => parseCli(['--password=super-secret'])).toThrow('Unknown command-line option');
    expect(() => parseCli(['--password=super-secret'])).not.toThrow('super-secret');
    expect(
      parseCli([
        '--dry-run',
        '--environment',
        'production',
        '--confirm-production-provisioning',
        '--email',
        'owner@example.com',
        '--display-name',
        'Owner',
        '--expires-at',
        expiry.toISOString(),
        '--tenant-id',
        scopeIds.tenantId,
        '--legal-entity-id',
        scopeIds.legalEntityId,
        '--station-id',
        scopeIds.stationId,
      ]).mode,
    ).toBe('dry-run');
  });

  it('preserves Better Auth credential hashing and verification semantics', async () => {
    const password = 'a test password that is never logged';
    const hash = await hashPassword(password);
    expect(hash).not.toBe(password);
    expect(await verifyPassword({ hash, password })).toBe(true);
    expect(await verifyPassword({ hash, password: `${password}!` })).toBe(false);
  });
});
