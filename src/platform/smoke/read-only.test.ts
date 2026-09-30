import { describe, expect, it, vi } from 'vitest';
import {
  createReadOnlyHttpClient,
  isReadOnlyHttpMethod,
  parseReadOnlySmokeCli,
  runReadOnlyVerification,
  safeCliError,
  validateReadOnlySmokeTarget,
} from './read-only';

const tenantA = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  stationId: '22222222-2222-4222-8222-222222222222',
};
const tenantB = {
  tenantId: '33333333-3333-4333-8333-333333333333',
  stationId: '44444444-4444-4444-8444-444444444444',
};
const requestId = '55555555-5555-4555-8555-555555555555';

const validTarget = (overrides: Record<string, unknown> = {}) => ({
  environment: 'staging' as const,
  baseUrl: 'https://staging.example.test',
  sessionCookie: 'shanda-fuel.session_token=opaque-session-value',
  tenantA,
  ...overrides,
});

const response = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
  });

const healthyResponses = (url: string) => {
  if (url.endsWith('/api/health')) {
    return response({ status: 'ok', checks: { application: 'ok' } });
  }
  if (url.endsWith('/api/readiness')) {
    return response({ status: 'ok', checks: { database: { status: 'ok' } } });
  }
  if (url.includes(tenantA.tenantId)) return response({ sensitive: 'tenant-a-data' });
  return response({ sensitive: 'tenant-b-data' }, 404);
};

describe('read-only HTTP safety', () => {
  it('emits only GET and HEAD and rejects every write method', async () => {
    const methods: string[] = [];
    const fetcher = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      methods.push(init?.method ?? '');
      return response('ok');
    });
    const client = createReadOnlyHttpClient({
      timeoutMs: 1000,
      fetcher,
    });
    await client.get('https://staging.example.test/get');
    await client.head('https://staging.example.test/head');

    expect(methods).toEqual(['GET', 'HEAD']);
    expect(isReadOnlyHttpMethod('GET')).toBe(true);
    expect(isReadOnlyHttpMethod('HEAD')).toBe(true);
    expect(isReadOnlyHttpMethod('POST')).toBe(false);
    expect(isReadOnlyHttpMethod('PUT')).toBe(false);
    expect(isReadOnlyHttpMethod('PATCH')).toBe(false);
    expect(isReadOnlyHttpMethod('DELETE')).toBe(false);
  });

  it('sends the opaque session cookie only to authenticated checks', async () => {
    const calls: Array<{ method?: string; cookie?: string; bypass?: string }> = [];
    const fetcher = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method,
        cookie: new Headers(init?.headers).get('cookie') ?? undefined,
        bypass: new Headers(init?.headers).get('x-vercel-protection-bypass') ?? undefined,
      });
      return response('ok');
    });
    const client = createReadOnlyHttpClient({
      timeoutMs: 1000,
      sessionCookie: 'shanda-fuel.session_token=opaque',
      vercelAutomationBypassSecret: 'bypass-secret',
      fetcher,
    });

    await client.get('https://staging.example.test/public');
    await client.get('https://staging.example.test/private', { authenticated: true });

    expect(calls).toEqual([
      { method: 'GET', cookie: undefined, bypass: 'bypass-secret' },
      { method: 'GET', cookie: 'shanda-fuel.session_token=opaque', bypass: 'bypass-secret' },
    ]);
  });

  it('omits the protection bypass header when it is not configured', async () => {
    const fetcher = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-vercel-protection-bypass')).toBeNull();
      return response('ok');
    });
    const client = createReadOnlyHttpClient({ timeoutMs: 1000, fetcher });

    await client.get('https://staging.example.test/public');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('read-only smoke target protection', () => {
  it('requires explicit production confirmation', () => {
    expect(() =>
      validateReadOnlySmokeTarget({
        ...validTarget(),
        environment: 'production',
      }),
    ).toThrow('confirm-readonly-production');

    expect(
      validateReadOnlySmokeTarget({
        ...validTarget(),
        environment: 'production',
        confirmProduction: true,
        baseUrl: 'https://production.example.test',
      }).environment,
    ).toBe('production');
  });

  it('fails closed for an ambiguous environment and non-HTTPS target', () => {
    expect(() =>
      validateReadOnlySmokeTarget({ ...validTarget(), environment: 'local' as never }),
    ).toThrow('staging or production');
    expect(() =>
      validateReadOnlySmokeTarget({ ...validTarget(), baseUrl: 'http://staging.example.test' }),
    ).toThrow('HTTPS');
  });

  it('rejects base URL credentials, paths, queries, and fragments', () => {
    for (const baseUrl of [
      'https://user:password@staging.example.test',
      'https://staging.example.test/app',
      'https://staging.example.test?secret=value',
      'https://staging.example.test#fragment',
    ]) {
      expect(() => validateReadOnlySmokeTarget({ ...validTarget(), baseUrl })).toThrow(
        'HTTPS origin',
      );
    }
  });

  it('rejects same-tenant Tenant A and Tenant B configuration', () => {
    expect(() =>
      validateReadOnlySmokeTarget({
        ...validTarget(),
        tenantB: { ...tenantB, tenantId: tenantA.tenantId },
      }),
    ).toThrow('different tenant');
  });

  it('rejects same-tenant UUIDs when Tenant A and B use different casing', () => {
    const tenantIdUppercase = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
    const tenantIdLowercase = tenantIdUppercase.toLowerCase();

    expect(() =>
      validateReadOnlySmokeTarget({
        ...validTarget({ tenantA: { ...tenantA, tenantId: tenantIdUppercase } }),
        tenantB: { ...tenantB, tenantId: tenantIdLowercase },
      }),
    ).toThrow('different tenant');
  });

  it('rejects unsafe deployment IDs and commit identifiers without echoing them', () => {
    const invalidDeploymentId = 'deployment secret value';
    const invalidCommit = 'commit/secret-value';

    expect(() =>
      validateReadOnlySmokeTarget({ ...validTarget(), deploymentId: invalidDeploymentId }),
    ).toThrow('Deployment ID must contain only safe identifier characters.');
    expect(() => validateReadOnlySmokeTarget({ ...validTarget(), commit: invalidCommit })).toThrow(
      'Commit identifier must contain only safe identifier characters.',
    );
    expect(() =>
      validateReadOnlySmokeTarget({ ...validTarget(), deploymentId: invalidDeploymentId }),
    ).not.toThrow(invalidDeploymentId);
    expect(() =>
      validateReadOnlySmokeTarget({ ...validTarget(), commit: invalidCommit }),
    ).not.toThrow(invalidCommit);
  });

  it('rejects session cookies containing control characters', () => {
    expect(() =>
      validateReadOnlySmokeTarget({
        ...validTarget(),
        sessionCookie: 'session=value\nforbidden',
      }),
    ).toThrow('control characters');
  });

  it('rejects protection bypass secrets containing control characters', () => {
    expect(() =>
      createReadOnlyHttpClient({
        timeoutMs: 1000,
        vercelAutomationBypassSecret: 'bypass\nsecret',
        fetcher: vi.fn(),
      }),
    ).toThrow('control characters');
  });

  it('requires an explicit environment in CLI options and rejects APP_ENV mismatch', () => {
    expect(() =>
      parseReadOnlySmokeCli(
        [
          '--base-url',
          'https://staging.example.test',
          '--tenant-a-id',
          tenantA.tenantId,
          '--station-a-id',
          tenantA.stationId,
        ],
        { APP_ENV: 'staging' },
      ),
    ).toThrow('Usage:');

    expect(() =>
      parseReadOnlySmokeCli(
        [
          '--environment',
          'production',
          '--base-url',
          'https://production.example.test',
          '--tenant-a-id',
          tenantA.tenantId,
          '--station-a-id',
          tenantA.stationId,
        ],
        { APP_ENV: 'staging' },
      ),
    ).toThrow('does not match');
  });

  it('does not echo secret-like unknown CLI input in safe errors', () => {
    const secretLikeArgument = 'session-token=do-not-print-this';
    let error: unknown;

    try {
      parseReadOnlySmokeCli([secretLikeArgument]);
    } catch (caught) {
      error = caught;
    }

    const safeError = safeCliError(error);
    expect(safeError).toBe('Unknown command-line option.');
    expect(safeError).not.toContain(secretLikeArgument);
  });

  it('does not accept the protection bypass secret as a CLI argument', () => {
    const secret = 'bypass-secret-must-not-be-an-argument';
    let error: unknown;

    try {
      parseReadOnlySmokeCli(['--vercel-automation-bypass-secret', secret]);
    } catch (caught) {
      error = caught;
    }

    const safeError = safeCliError(error);
    expect(safeError).toBe('Unknown command-line option.');
    expect(safeError).not.toContain(secret);
  });

  it('does not copy the process-environment bypass secret into parsed options', () => {
    const secret = 'bypass-secret-must-not-be-returned';
    const options = parseReadOnlySmokeCli(
      [
        '--environment',
        'staging',
        '--base-url',
        'https://staging.example.test',
        '--tenant-a-id',
        tenantA.tenantId,
        '--station-a-id',
        tenantA.stationId,
      ],
      { APP_ENV: 'staging', VERCEL_AUTOMATION_BYPASS_SECRET: secret },
    );

    expect(options).not.toHaveProperty('vercelAutomationBypassSecret');
    expect(JSON.stringify(options)).not.toContain(secret);
  });
});

describe('read-only verification evidence', () => {
  it('passes health, readiness, Tenant A access, and Tenant B denial without exposing data', async () => {
    const bypassSecret = 'bypass-secret-must-not-appear';
    const requestHeaders: Headers[] = [];
    const evidence = await runReadOnlyVerification(
      validTarget({ tenantB, deploymentId: 'dpl_safe_123', commit: 'ba38adf' }),
      {
        vercelAutomationBypassSecret: bypassSecret,
        fetcher: async (input, init) => {
          requestHeaders.push(new Headers(init?.headers));
          return healthyResponses(String(input));
        },
      },
    );

    expect(evidence.pass).toBe(true);
    expect(evidence.checks.map((check) => [check.name, check.status])).toEqual([
      ['health', 'passed'],
      ['readiness', 'passed'],
      ['tenant-a-access', 'passed'],
      ['tenant-b-denial', 'passed'],
    ]);
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('tenant-a-data');
    expect(serialized).not.toContain('opaque-session-value');
    expect(serialized).not.toContain('tenant-b-data');
    expect(serialized).not.toContain(bypassSecret);
    expect(requestHeaders).toHaveLength(4);
    expect(
      requestHeaders.every((headers) => headers.get('x-vercel-protection-bypass') === bypassSecret),
    ).toBe(true);
    expect(
      evidence.checks.every((check) =>
        Object.keys(check).every((key) =>
          ['name', 'status', 'required', 'httpStatus', 'requestId', 'elapsedMs', 'code'].includes(
            key,
          ),
        ),
      ),
    ).toBe(true);
  });

  it('fails with a readiness-specific code when readiness returns 503', async () => {
    const evidence = await runReadOnlyVerification(validTarget(), {
      fetcher: async (input) => {
        if (String(input).endsWith('/api/health')) {
          return response({ status: 'ok', checks: { application: 'ok' } });
        }
        return response({ status: 'not_ready' }, 503);
      },
    });

    expect(evidence.pass).toBe(false);
    expect(evidence.checks.find((check) => check.name === 'readiness')).toMatchObject({
      status: 'failed',
      code: 'readiness_failure',
      httpStatus: 503,
    });
  });

  it.each([
    [401, 'authentication_not_configured'],
    [403, 'forbidden'],
    [500, 'server_error'],
  ] as const)(
    'classifies authenticated HTTP %s without exposing the response',
    async (status, code) => {
      const evidence = await runReadOnlyVerification(validTarget(), {
        fetcher: async (input) => {
          if (String(input).endsWith('/api/health')) {
            return response({ status: 'ok', checks: { application: 'ok' } });
          }
          if (String(input).endsWith('/api/readiness')) {
            return response({ status: 'ok', checks: { database: { status: 'ok' } } });
          }
          return response({ secret: 'must-not-appear' }, status);
        },
      });

      expect(evidence.pass).toBe(false);
      expect(evidence.checks.find((check) => check.name === 'tenant-a-access')).toMatchObject({
        status: 'failed',
        code,
        httpStatus: status,
      });
      expect(JSON.stringify(evidence)).not.toContain('must-not-appear');
    },
  );

  it('handles malformed health responses and redirects without dumping bodies', async () => {
    const malformed = await runReadOnlyVerification(validTarget(), {
      fetcher: async (input) => {
        if (String(input).endsWith('/api/health')) return response('{not-json');
        return healthyResponses(String(input));
      },
    });
    expect(malformed.checks.find((check) => check.name === 'health')).toMatchObject({
      status: 'failed',
      code: 'malformed_response',
    });

    const redirect = await runReadOnlyVerification(validTarget(), {
      fetcher: async (input) => {
        if (String(input).endsWith('/api/health')) {
          return response({ status: 'ok', checks: { application: 'ok' } });
        }
        if (String(input).endsWith('/api/readiness')) return response('', 302);
        return healthyResponses(String(input));
      },
    });
    expect(redirect.checks.find((check) => check.name === 'readiness')).toMatchObject({
      status: 'failed',
      code: 'unexpected_redirect',
    });
  });

  it('handles timeout and missing authentication without issuing authenticated requests', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    const timeoutEvidence = await runReadOnlyVerification(validTarget({ timeoutMs: 10 }), {
      fetcher,
    });
    expect(timeoutEvidence.pass).toBe(false);
    expect(
      timeoutEvidence.checks
        .filter((check) => check.required)
        .every((check) => check.code === 'timeout'),
    ).toBe(true);

    const missingAuthFetcher = vi.fn(async (input: string | URL) =>
      healthyResponses(String(input)),
    );
    const missingAuthEvidence = await runReadOnlyVerification(
      validTarget({ sessionCookie: undefined }),
      { fetcher: missingAuthFetcher },
    );
    expect(
      missingAuthEvidence.checks.find((check) => check.name === 'tenant-a-access'),
    ).toMatchObject({
      status: 'failed',
      code: 'authentication_not_configured',
    });
    expect(missingAuthFetcher).toHaveBeenCalledTimes(2);
  });

  it('records Tenant B access as a denial mismatch when the server returns 200', async () => {
    const evidence = await runReadOnlyVerification(validTarget({ tenantB }), {
      fetcher: async (input) => {
        if (String(input).endsWith('/api/health')) {
          return response({ status: 'ok', checks: { application: 'ok' } });
        }
        if (String(input).endsWith('/api/readiness')) {
          return response({ status: 'ok', checks: { database: { status: 'ok' } } });
        }
        return response({ data: 'unexpectedly visible' });
      },
    });

    expect(evidence.checks.find((check) => check.name === 'tenant-b-denial')).toMatchObject({
      status: 'failed',
      code: 'cross_tenant_denial_mismatch',
      httpStatus: 200,
    });
  });
});
