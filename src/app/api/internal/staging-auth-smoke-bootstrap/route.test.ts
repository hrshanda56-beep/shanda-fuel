import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAuditSigningKeyMock,
  postgresMock,
  createRepositoryMock,
  runBootstrapMock,
  transactionMock,
  transactionEvents,
} = vi.hoisted(() => ({
  getAuditSigningKeyMock: vi.fn(),
  postgresMock: vi.fn(),
  createRepositoryMock: vi.fn(),
  runBootstrapMock: vi.fn(),
  transactionMock: vi.fn(),
  transactionEvents: [] as string[],
}));

vi.mock('../../../../platform/config/env', () => ({
  getAuditSigningKey: getAuditSigningKeyMock,
}));
vi.mock('../../../../platform/staging/auth-smoke-bootstrap', () => ({
  STAGING_AUTH_SMOKE_IDS: {
    tenantId: 'a1000000-0000-4000-8000-000000000001',
    actorId: 'a2000000-0000-4000-8000-000000000001',
    membershipId: 'a3000000-0000-4000-8000-000000000001',
    legalEntityId: 'a4000000-0000-4000-8000-000000000001',
    stationId: 'a5000000-0000-4000-8000-000000000001',
  },
  STAGING_AUTH_SMOKE_PERMISSIONS: [
    'business_day.view',
    'business_day.open',
    'shift.view',
    'shift.start',
  ],
  createSqlStagingAuthSmokeRepository: createRepositoryMock,
  runStagingAuthSmokeBootstrap: runBootstrapMock,
}));
vi.mock('postgres', () => ({ default: postgresMock }));

import { POST } from './route';

const token = 'staging-bootstrap-token-0123456789012345';
const databaseUrl =
  'postgresql://operator:secret@ep-empty-boat-b1wong3k.c-5.eu-central-1.aws.neon.tech/shanda_fuel';
const auditKey = { keyId: 'staging-audit-v1', secret: 'audit-secret-that-is-not-a-response-value' };
const ids = {
  tenantId: 'a1000000-0000-4000-8000-000000000001',
  actorId: 'a2000000-0000-4000-8000-000000000001',
  membershipId: 'a3000000-0000-4000-8000-000000000001',
  legalEntityId: 'a4000000-0000-4000-8000-000000000001',
  stationId: 'a5000000-0000-4000-8000-000000000001',
};

let trackResultValidation = false;

function checkResult(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'check' as const,
    hierarchyValid: true,
    membershipValid: true,
    authUser: 'present' as const,
    credentialAccount: 'present' as const,
    permissionGrants: {
      'business_day.view': 'expired' as const,
      'business_day.open': 'expired' as const,
      'shift.view': 'expired' as const,
      'shift.start': 'expired' as const,
    },
    ...overrides,
  };
}

function bootstrapResult(overrides: Record<string, unknown> = {}) {
  const result = {
    ...checkResult(),
    mode: 'bootstrap' as const,
    permissionGrants: {
      'business_day.view': 'created' as const,
      'business_day.open': 'created' as const,
      'shift.view': 'created' as const,
      'shift.start': 'created' as const,
    },
    expiresAt: new Date('2026-09-30T12:00:00.000Z'),
    ...overrides,
  };
  const expiresAt = result.expiresAt;
  let firstRead = true;
  Object.defineProperty(result, 'expiresAt', {
    enumerable: true,
    get() {
      if (trackResultValidation && firstRead) {
        transactionEvents.push('result:validation');
        firstRead = false;
      }
      return expiresAt;
    },
  });
  return result;
}

function request(headers: Record<string, string> = {}, body?: string): Request {
  return new Request('https://fuel.example.test/api/internal/staging-auth-smoke-bootstrap', {
    method: 'POST',
    headers,
    body,
  });
}

function configureEnvironment(overrides: Record<string, string | undefined> = {}) {
  vi.stubEnv('APP_ENV', 'staging');
  vi.stubEnv('VERCEL_PROJECT_ID', 'prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4');
  vi.stubEnv('STAGING_AUTH_BOOTSTRAP_TOKEN', token);
  vi.stubEnv('STAGING_AUTH_BOOTSTRAP_DATABASE_URL', databaseUrl);
  vi.stubEnv('DATABASE_URL', databaseUrl);
  vi.stubEnv('APP_URL', 'https://staging.shandafuel.example');
  vi.stubEnv('BETTER_AUTH_SECRET', 'b'.repeat(32));
  vi.stubEnv('AUDIT_SIGNING_KEY_ID', auditKey.keyId);
  vi.stubEnv('AUDIT_SIGNING_KEY', auditKey.secret);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else vi.stubEnv(key, value);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionEvents.length = 0;
  trackResultValidation = false;
  configureEnvironment();
  getAuditSigningKeyMock.mockReturnValue(auditKey);
  createRepositoryMock.mockReturnValue({});
  transactionMock.mockImplementation(async (strings: TemplateStringsArray) => {
    transactionEvents.push(strings.join(''));
    return [];
  });
  runBootstrapMock.mockImplementation(async ({ mode }: { mode: string }) => {
    transactionEvents.push(`bootstrap:${mode}`);
    return mode === 'check' ? checkResult() : bootstrapResult();
  });
  postgresMock.mockReturnValue({
    begin: vi.fn(async (callback: (tx: typeof transactionMock) => Promise<unknown>) => {
      transactionEvents.push('transaction:begin');
      try {
        const result = await callback(transactionMock);
        transactionEvents.push('transaction:commit');
        return result;
      } catch (error) {
        transactionEvents.push('transaction:rollback');
        throw error;
      }
    }),
    end: vi.fn(async () => undefined),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('staging auth smoke bootstrap route', () => {
  it.each([
    ['production', 'production'],
    ['local', 'local'],
    [undefined, 'unset'],
  ])('refuses non-staging APP_ENV (%s)', async (appEnv, _label) => {
    configureEnvironment({ APP_ENV: appEnv });
    const response = await POST(request({ 'x-staging-bootstrap-token': token }));
    expect(response.status).toBe(403);
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['wrong', 'wrong-token-that-is-long-enough-0123456789'],
  ])('refuses a %s token', async (_label, providedToken) => {
    const response = await POST(
      request(providedToken ? { 'x-staging-bootstrap-token': providedToken } : {}),
    );
    expect(response.status).toBe(403);
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it('refuses when the bootstrap token environment variable is missing', async () => {
    configureEnvironment({ STAGING_AUTH_BOOTSTRAP_TOKEN: undefined });
    const response = await POST(request({ 'x-staging-bootstrap-token': token }));
    expect(response.status).toBe(403);
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it('refuses an unexpected Vercel project', async () => {
    configureEnvironment({ VERCEL_PROJECT_ID: 'prj_unexpected' });
    const response = await POST(request({ 'x-staging-bootstrap-token': token }));
    expect(response.status).toBe(403);
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it('refuses a wrong database target without opening a connection', async () => {
    configureEnvironment({
      STAGING_AUTH_BOOTSTRAP_DATABASE_URL:
        'postgresql://operator:secret@ep-wrong.c-5.eu-central-1.aws.neon.tech/shanda_fuel',
    });
    const response = await POST(request({ 'x-staging-bootstrap-token': token }));
    expect(response.status).toBe(403);
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it('refuses DATABASE_DIRECT_URL instead of accepting it as an alternate target', async () => {
    configureEnvironment({ DATABASE_DIRECT_URL: databaseUrl });
    const response = await POST(request({ 'x-staging-bootstrap-token': token }));
    expect(response.status).toBe(403);
    expect(postgresMock).not.toHaveBeenCalled();
  });

  it('requires the fixed existing auth user and credential account before refreshing grants', async () => {
    runBootstrapMock.mockResolvedValueOnce(checkResult({ credentialAccount: 'absent' }));
    const response = await POST(request({ 'x-staging-bootstrap-token': token }));
    expect(response.status).toBe(422);
    expect(runBootstrapMock).toHaveBeenCalledTimes(1);
    expect(runBootstrapMock).toHaveBeenCalledWith({
      repository: {},
      ids,
      mode: 'check',
      email: 'operator+smoke@staging.shandafuel.invalid',
    });
  });

  it('refuses a required grant that is still active', async () => {
    runBootstrapMock.mockResolvedValueOnce(
      checkResult({
        permissionGrants: {
          'business_day.view': 'present',
          'business_day.open': 'expired',
          'shift.view': 'expired',
          'shift.start': 'expired',
        },
      }),
    );
    const response = await POST(request({ 'x-staging-bootstrap-token': token }));
    expect(response.status).toBe(422);
    expect(runBootstrapMock).toHaveBeenCalledOnce();
  });

  it('serializes before checking and checks again before bootstrapping', async () => {
    trackResultValidation = true;
    const response = await POST(request({ 'x-staging-bootstrap-token': token }));

    expect(response.status).toBe(200);
    const lockIndex = transactionEvents.findIndex((event) =>
      event.includes('pg_advisory_xact_lock'),
    );
    const checkIndex = transactionEvents.indexOf('bootstrap:check');
    const bootstrapIndex = transactionEvents.indexOf('bootstrap:bootstrap');
    const validationIndex = transactionEvents.indexOf('result:validation');
    const commitIndex = transactionEvents.indexOf('transaction:commit');
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(checkIndex);
    expect(checkIndex).toBeLessThan(bootstrapIndex);
    expect(bootstrapIndex).toBeLessThan(validationIndex);
    expect(validationIndex).toBeLessThan(commitIndex);
    expect(transactionEvents.at(-1)).toBe('transaction:commit');
  });

  it.each(['present', 'expired', 'absent'] as const)(
    'fails closed when bootstrap returns a %s grant status',
    async (status) => {
      runBootstrapMock.mockResolvedValueOnce(checkResult()).mockResolvedValueOnce(
        bootstrapResult({
          permissionGrants: {
            'business_day.view': 'created',
            'business_day.open': 'created',
            'shift.view': 'created',
            'shift.start': status,
          },
        }),
      );

      const response = await POST(request({ 'x-staging-bootstrap-token': token }));

      expect(response.status).toBe(422);
      expect(runBootstrapMock).toHaveBeenCalledTimes(2);
      expect(await response.json()).toMatchObject({ error: 'INVARIANT_VIOLATION' });
      expect(transactionEvents.at(-1)).toBe('transaction:rollback');
      expect(transactionEvents).not.toContain('transaction:commit');
    },
  );

  it('refreshes only expired grants and returns no secrets, email, or identifiers', async () => {
    const response = await POST(
      request(
        { 'x-staging-bootstrap-token': token },
        JSON.stringify({ password: 'must-not-be-used-by-this-route' }),
      ),
    );
    expect(response.status).toBe(200);
    expect(postgresMock).toHaveBeenCalledWith(databaseUrl, { max: 1, prepare: false });
    expect(getAuditSigningKeyMock).toHaveBeenCalledOnce();
    expect(runBootstrapMock).toHaveBeenNthCalledWith(1, {
      repository: {},
      ids,
      mode: 'check',
      email: 'operator+smoke@staging.shandafuel.invalid',
    });
    expect(runBootstrapMock).toHaveBeenNthCalledWith(2, {
      repository: {},
      ids,
      mode: 'bootstrap',
      email: 'operator+smoke@staging.shandafuel.invalid',
      requireExistingCredentialAccount: true,
      auditKey,
    });
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      grantStatuses: {
        'business_day.view': 'created',
        'business_day.open': 'created',
        'shift.view': 'created',
        'shift.start': 'created',
      },
      expiresAt: '2026-09-30T12:00:00.000Z',
    });
    expect(JSON.stringify(body)).not.toContain(token);
    expect(JSON.stringify(body)).not.toContain(databaseUrl);
    expect(JSON.stringify(body)).not.toContain(auditKey.secret);
    expect(JSON.stringify(body)).not.toContain('operator+smoke@staging.shandafuel.invalid');
    for (const secret of [
      ids.tenantId,
      ids.stationId,
      ids.actorId,
      ids.membershipId,
      ids.legalEntityId,
      'must-not-be-used-by-this-route',
    ]) {
      expect(JSON.stringify(body)).not.toContain(secret);
    }
  });
});
