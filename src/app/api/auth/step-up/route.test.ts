import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../platform/errors';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  resolveContext: vi.fn(),
  establish: vi.fn(),
  ClerkReverificationRequiredError: class ClerkReverificationRequiredError extends Error {
    constructor(
      readonly level: 'strict' | 'strict_mfa' = 'strict',
      readonly challengeCookie = 'shanda-fuel.clerk-step-up-challenge=test',
    ) {
      super('Clerk reverification is required for this action');
    }
  },
}));

vi.mock('../../../../modules/identity', () => ({
  ClerkReverificationRequiredError: mocks.ClerkReverificationRequiredError,
  establishStepUp: mocks.establish,
  requireAuthenticatedActor: mocks.authenticate,
}));

vi.mock('../../../../modules/tenancy/authority', () => ({
  resolveTenantExecutionContext: mocks.resolveContext,
}));

import { POST } from './route';

const tenantId = '11111111-1111-4111-8111-111111111111';
const context = { membership: { tenantId } };

function request(body: unknown): Request {
  return new Request('https://fuel.example.test/api/auth/step-up', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/step-up', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authenticate.mockResolvedValue({});
    mocks.resolveContext.mockResolvedValue(context);
    mocks.establish.mockResolvedValue({
      level: 1,
      tenantId,
      expiresAt: '2026-09-27T10:10:00.000Z',
    });
  });

  it('authenticates before parsing and establishes the current tenant step-up', async () => {
    const response = await POST(request({ tenantId, password: 'correct', totpCode: '123456' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'active',
      stepUpLevel: 1,
      expiresAt: '2026-09-27T10:10:00.000Z',
    });
    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
    expect(mocks.resolveContext).toHaveBeenCalledWith(
      expect.objectContaining({ requestedTenantId: tenantId }),
    );
    expect(mocks.establish).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'correct', totpCode: '123456', context }),
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns a generic forbidden response for a failed challenge', async () => {
    mocks.establish.mockRejectedValueOnce(new AppError('FORBIDDEN', 'Step-up verification failed'));

    const response = await POST(request({ tenantId, password: 'wrong', totpCode: '000000' }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: 'FORBIDDEN',
      message: 'Step-up verification failed',
    });
  });

  it('returns Clerk’s reverification hint and challenge cookie', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'CLERK');
    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_fake_clerk_fixture');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_fake_clerk_fixture');
    mocks.establish.mockRejectedValueOnce(
      new mocks.ClerkReverificationRequiredError(
        'strict',
        'shanda-fuel.clerk-step-up-challenge=test',
      ),
    );

    const response = await POST(request({ tenantId, action: 'LOCK_BUSINESS_DAY' }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      clerk_error: {
        type: 'forbidden',
        reason: 'reverification-error',
        metadata: { reverification: 'strict' },
      },
    });
    expect(mocks.establish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LOCK_BUSINESS_DAY',
        context,
        password: '',
        totpCode: '',
      }),
    );
    expect(response.headers.get('Set-Cookie')).toContain('shanda-fuel.clerk-step-up-challenge');
  });

  it('records only redacted diagnostic stages for the staff deactivation action', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubEnv('AUTH_PROVIDER', 'CLERK');
    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_fake_clerk_fixture');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_fake_clerk_fixture');
    mocks.establish.mockRejectedValueOnce(
      new mocks.ClerkReverificationRequiredError(
        'strict',
        'shanda-fuel.clerk-step-up-challenge=test',
      ),
    );

    await POST(request({ tenantId, action: 'DEACTIVATE_STAFF_MEMBER' }));

    const records = info.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((record) => record.message === 'auth.step_up.diagnostic');
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.stage)).toEqual(['received', 'challenge_required']);
    expect(records[0]).toMatchObject({
      action: 'DEACTIVATE_STAFF_MEMBER',
      status: null,
      statusClass: 'unknown',
    });
    expect(JSON.stringify(records)).not.toContain('sk_fake_clerk_fixture');
    expect(JSON.stringify(records)).not.toContain('test');
    info.mockRestore();
  });

  it('records reverified and completed stages without provider details', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubEnv('AUTH_PROVIDER', 'CLERK');
    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_fake_clerk_fixture');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_fake_clerk_fixture');

    const response = await POST(request({ tenantId, action: 'DEACTIVATE_STAFF_MEMBER' }));

    expect(response.status).toBe(200);
    const records = info.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((record) => record.message === 'auth.step_up.diagnostic');
    expect(records.map((record) => record.stage)).toEqual(['received', 'reverified', 'completed']);
    expect(records.every((record) => record.action === 'DEACTIVATE_STAFF_MEMBER')).toBe(true);
    info.mockRestore();
  });

  it('accepts the dedicated staff deactivation step-up action', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'CLERK');
    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_fake_clerk_fixture');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_fake_clerk_fixture');

    const response = await POST(request({ tenantId, action: 'DEACTIVATE_STAFF_MEMBER' }));

    expect(response.status).toBe(200);
    expect(mocks.establish).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DEACTIVATE_STAFF_MEMBER', context }),
    );
  });

  it('does not parse an unauthenticated request body', async () => {
    mocks.authenticate.mockRejectedValueOnce(
      new AppError('UNAUTHENTICATED', 'Authentication is required'),
    );
    const unauthenticated = request({ tenantId, password: 'correct', totpCode: '123456' });
    const json = vi.spyOn(unauthenticated, 'json');

    const response = await POST(unauthenticated);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.resolveContext).not.toHaveBeenCalled();
  });

  it('rejects a password-only request before provider verification', async () => {
    const response = await POST(request({ tenantId, password: 'correct' }));

    expect(response.status).toBe(400);
    expect(mocks.resolveContext).not.toHaveBeenCalled();
    expect(mocks.establish).not.toHaveBeenCalled();
  });
});
