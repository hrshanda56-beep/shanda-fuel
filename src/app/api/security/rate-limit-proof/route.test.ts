import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  rateLimitEntry: vi.fn(),
  rateLimitDenied: false,
}));

vi.mock('../../../../modules/identity', () => ({
  requireAuthenticatedActor: mocks.authenticate,
}));

vi.mock('../../../../platform/security', () => ({
  STAGING_RATE_LIMIT_PROOF_POLICY: { scope: 'proof', limit: 20, windowSeconds: 60 },
  withPersistentRateLimit:
    (handler: (request: Request) => Promise<Response>) => async (request: Request) => {
      mocks.rateLimitEntry();
      if (mocks.rateLimitDenied) {
        return new Response(null, {
          status: 429,
          headers: {
            'retry-after': '60',
            'x-ratelimit-limit': '20',
            'x-ratelimit-remaining': '0',
          },
        });
      }
      return handler(request);
    },
}));

import { AppError } from '../../../../platform/errors';
import { GET } from './route';

function request(): Request {
  return new Request('https://staging.example.test/api/security/rate-limit-proof', {
    method: 'GET',
  });
}

describe('GET /api/security/rate-limit-proof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.rateLimitDenied = false;
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('VERCEL_PROJECT_ID', undefined);
    mocks.authenticate.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('authenticates and returns an empty non-mutating success response', async () => {
    const response = await GET(request());

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
    expect(mocks.rateLimitEntry).toHaveBeenCalledTimes(1);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('runs the limiter before authentication and never authenticates a denied request', async () => {
    mocks.rateLimitDenied = true;

    const response = await GET(request());

    expect(response.status).toBe(429);
    expect(mocks.rateLimitEntry).toHaveBeenCalledTimes(1);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('returns the normal unauthenticated response when the limiter allows', async () => {
    mocks.authenticate.mockRejectedValue(
      new AppError('UNAUTHENTICATED', 'Authentication is required'),
    );

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'UNAUTHENTICATED' });
    expect(mocks.rateLimitEntry).toHaveBeenCalledTimes(1);
    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
    const [rateLimitOrder] = mocks.rateLimitEntry.mock.invocationCallOrder;
    const [authenticateOrder] = mocks.authenticate.mock.invocationCallOrder;
    expect(rateLimitOrder).toBeDefined();
    expect(authenticateOrder).toBeDefined();
    expect(rateLimitOrder!).toBeLessThan(authenticateOrder!);
  });

  it.each([
    ['production', 'prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4'],
    ['local', 'prj_Bg5vKaqhyVQipr4o7PI7LdeSrNX4'],
    ['staging', 'prj_wrong'],
    ['staging', ''],
  ])('returns the same empty 404 for %s with project %s', async (environment, projectId) => {
    vi.stubEnv('APP_ENV', environment);
    vi.stubEnv('VERCEL_PROJECT_ID', projectId);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.rateLimitEntry).not.toHaveBeenCalled();
  });
});
