import { verifyPassword } from 'better-auth/crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertExactSyntheticIds,
  runStagingAuthSmokeBootstrap,
  STAGING_AUTH_SMOKE_DISPLAY_NAME,
  STAGING_AUTH_SMOKE_IDS,
  STAGING_AUTH_SMOKE_PERMISSIONS,
  STAGING_AUTH_SMOKE_TTL_MS,
  type StagingAuthSmokeRepository,
  type StagingAuthSmokeState,
} from './auth-smoke-bootstrap';
import { assertStagingSmokeAllowed } from '../config/staging-smoke';

const now = new Date('2026-09-23T10:00:00.000Z');
const email = 'operator+smoke@staging.shandafuel.invalid';
const password = 'runtime-only-test-password';

function baseState(overrides: Partial<StagingAuthSmokeState> = {}): StagingAuthSmokeState {
  return {
    now,
    tenant: { id: STAGING_AUTH_SMOKE_IDS.tenantId, status: 'ACTIVE' },
    legalEntity: {
      id: STAGING_AUTH_SMOKE_IDS.legalEntityId,
      tenantId: STAGING_AUTH_SMOKE_IDS.tenantId,
      status: 'ACTIVE',
    },
    station: {
      id: STAGING_AUTH_SMOKE_IDS.stationId,
      tenantId: STAGING_AUTH_SMOKE_IDS.tenantId,
      legalEntityId: STAGING_AUTH_SMOKE_IDS.legalEntityId,
      status: 'ACTIVE',
    },
    membership: {
      id: STAGING_AUTH_SMOKE_IDS.membershipId,
      tenantId: STAGING_AUTH_SMOKE_IDS.tenantId,
      identityId: STAGING_AUTH_SMOKE_IDS.actorId,
      status: 'ACTIVE',
    },
    user: null,
    emailOwnerId: null,
    credentialAccounts: [],
    permissionCodes: [...STAGING_AUTH_SMOKE_PERMISSIONS],
    grants: [],
    ...overrides,
  };
}

function fakeRepository(initial = baseState()): {
  repository: StagingAuthSmokeRepository;
  state: StagingAuthSmokeState;
  writes: {
    users: Array<{ id: string; name: string; email: string }>;
    accounts: Array<{ userId: string; accountId: string; passwordHash: string }>;
    grants: Array<{
      tenantId: string;
      membershipId: string;
      permissionCode: (typeof STAGING_AUTH_SMOKE_PERMISSIONS)[number];
      legalEntityId: string;
      stationId: string;
      expiresAt: Date;
      reason: string;
    }>;
    events: unknown[];
  };
} {
  const state = structuredClone(initial);
  const writes = { users: [], accounts: [], grants: [], events: [] } as ReturnType<
    typeof fakeRepository
  >['writes'];
  const repository: StagingAuthSmokeRepository = {
    async readState() {
      return state;
    },
    async createUser(input) {
      writes.users.push(input);
      state.user = input;
    },
    async createCredentialAccount(input) {
      writes.accounts.push(input);
      state.credentialAccounts.push({
        id: 'generated-account-id',
        accountId: input.accountId,
        providerId: 'credential',
        userId: input.userId,
        hasPassword: true,
      });
    },
    async createPermissionGrant(input) {
      writes.grants.push(input);
      state.grants.push({
        id: `grant-${writes.grants.length}`,
        tenantId: input.tenantId,
        membershipId: input.membershipId,
        permissionCode: input.permissionCode,
        scopeType: 'STATION',
        legalEntityId: input.legalEntityId,
        stationId: input.stationId,
        expiresAt: input.expiresAt,
        revokedAt: null,
      });
    },
    async appendSecurityEvent(event) {
      writes.events.push(event);
    },
  };
  return { repository, state, writes };
}

const auditKey = { keyId: 'test-key', secret: 'test-audit-secret' };

describe('staging auth smoke bootstrap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses production before any database work', () => {
    expect(() => assertStagingSmokeAllowed('production')).toThrow('Refusing staging smoke');
  });

  it.each([
    ['tenantId', 'wrong-tenant'],
    ['stationId', 'wrong-station'],
  ] as const)('refuses a non-synthetic %s', (key, value) => {
    expect(() => assertExactSyntheticIds({ ...STAGING_AUTH_SMOKE_IDS, [key]: value })).toThrow(
      `Refusing non-synthetic ${key}`,
    );
  });

  it('refuses a membership bound to another identity', async () => {
    const { repository } = fakeRepository(
      baseState({
        membership: {
          ...baseState().membership!,
          identityId: 'a2000000-0000-4000-8000-000000000002',
        },
      }),
    );
    await expect(
      runStagingAuthSmokeBootstrap({
        repository,
        ids: STAGING_AUTH_SMOKE_IDS,
        mode: 'check',
      }),
    ).rejects.toThrow('incorrectly bound');
  });

  it('refuses an inactive membership', async () => {
    const { repository } = fakeRepository(
      baseState({ membership: { ...baseState().membership!, status: 'DISABLED' } }),
    );
    await expect(
      runStagingAuthSmokeBootstrap({
        repository,
        ids: STAGING_AUTH_SMOKE_IDS,
        mode: 'check',
      }),
    ).rejects.toThrow('inactive');
  });

  it('refuses an existing mismatched auth user', async () => {
    const { repository } = fakeRepository(
      baseState({
        user: {
          id: STAGING_AUTH_SMOKE_IDS.actorId,
          name: 'Real Operator',
          email,
        },
      }),
    );
    await expect(
      runStagingAuthSmokeBootstrap({
        repository,
        ids: STAGING_AUTH_SMOKE_IDS,
        mode: 'bootstrap',
        email,
        password,
        auditKey,
      }),
    ).rejects.toThrow('display name');
  });

  it('creates only Actor A and only the two Station A grants', async () => {
    const { repository, writes } = fakeRepository();
    const result = await runStagingAuthSmokeBootstrap({
      repository,
      ids: STAGING_AUTH_SMOKE_IDS,
      mode: 'bootstrap',
      email,
      password,
      auditKey,
    });

    expect(writes.users).toEqual([
      { id: STAGING_AUTH_SMOKE_IDS.actorId, name: STAGING_AUTH_SMOKE_DISPLAY_NAME, email },
    ]);
    expect(writes.grants).toHaveLength(2);
    expect(writes.grants.map((grant) => grant.permissionCode)).toEqual(
      expect.arrayContaining([...STAGING_AUTH_SMOKE_PERMISSIONS]),
    );
    expect(writes.grants.every((grant) => grant.tenantId === STAGING_AUTH_SMOKE_IDS.tenantId)).toBe(
      true,
    );
    expect(
      writes.grants.every((grant) => grant.stationId === STAGING_AUTH_SMOKE_IDS.stationId),
    ).toBe(true);
    expect(result.expiresAt?.getTime()).toBe(now.getTime() + STAGING_AUTH_SMOKE_TTL_MS);
  });

  it('uses Better Auth supported password hashing and never exposes the password or hash', async () => {
    const { repository, writes } = fakeRepository();
    const log = vi.spyOn(console, 'log');
    await runStagingAuthSmokeBootstrap({
      repository,
      ids: STAGING_AUTH_SMOKE_IDS,
      mode: 'bootstrap',
      email,
      password,
      auditKey,
    });

    const hash = writes.accounts[0]?.passwordHash;
    expect(hash).toBeTruthy();
    expect(await verifyPassword({ hash: hash!, password })).toBe(true);
    expect(hash).not.toBe(password);
    expect(JSON.stringify(log.mock.calls)).not.toContain(password);
    expect(JSON.stringify(writes.events)).not.toContain(password);
    expect(JSON.stringify(writes.events)).not.toContain(hash!);
  });

  it('is idempotent while active grants exist and creates no session', async () => {
    const first = fakeRepository();
    await runStagingAuthSmokeBootstrap({
      repository: first.repository,
      ids: STAGING_AUTH_SMOKE_IDS,
      mode: 'bootstrap',
      email,
      password,
      auditKey,
    });
    const counts = {
      users: first.writes.users.length,
      accounts: first.writes.accounts.length,
      grants: first.writes.grants.length,
    };

    await runStagingAuthSmokeBootstrap({
      repository: first.repository,
      ids: STAGING_AUTH_SMOKE_IDS,
      mode: 'bootstrap',
      email,
      password,
      auditKey,
    });

    expect(first.writes.users).toHaveLength(counts.users);
    expect(first.writes.accounts).toHaveLength(counts.accounts);
    expect(first.writes.grants).toHaveLength(counts.grants);
    expect(first.writes.events).toHaveLength(2);
  });

  it('never mutates Tenant B through the repository contract', async () => {
    const { repository, writes } = fakeRepository();
    await runStagingAuthSmokeBootstrap({
      repository,
      ids: STAGING_AUTH_SMOKE_IDS,
      mode: 'bootstrap',
      email,
      password,
      auditKey,
    });
    expect(writes.users.every((user) => user.id === STAGING_AUTH_SMOKE_IDS.actorId)).toBe(true);
    expect(writes.grants.every((grant) => grant.tenantId === STAGING_AUTH_SMOKE_IDS.tenantId)).toBe(
      true,
    );
  });
});
