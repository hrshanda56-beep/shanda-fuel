import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('../db', () => ({
  getDatabase: () => ({ execute: mocks.execute }),
}));
import {
  AUTH_RATE_LIMIT,
  getRateLimitClientAddress,
  hashRateLimitKey,
  rateLimitResponse,
  STAGING_RATE_LIMIT_PROOF_POLICY,
  WRITE_RATE_LIMIT,
  withPersistentRateLimit,
} from './rate-limit';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('persistent rate-limit boundary', () => {
  it('uses the normalized deployment-edge address and falls back safely', () => {
    expect(
      getRateLimitClientAddress(
        new Request('https://fuel.example.test', {
          headers: { 'x-forwarded-for': ' 203.0.113.4, 10.0.0.1 ' },
        }),
      ),
    ).toBe('203.0.113.4');
    expect(getRateLimitClientAddress(new Request('https://fuel.example.test'))).toBe(
      'unknown-client',
    );
  });

  it('hashes the bucket identity without retaining the client address', () => {
    const first = hashRateLimitKey('auth', '203.0.113.4');
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain('203.0.113.4');
    expect(hashRateLimitKey('auth', '203.0.113.4')).toBe(first);
    expect(hashRateLimitKey('write', '203.0.113.4')).not.toBe(first);
  });

  it('exposes bounded retry metadata on a denied request', async () => {
    const response = rateLimitResponse({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 17,
      limit: AUTH_RATE_LIMIT.limit,
    });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('17');
    expect(response.headers.get('x-ratelimit-limit')).toBe(String(AUTH_RATE_LIMIT.limit));
    expect(response.headers.get('x-ratelimit-remaining')).toBe('0');
    await expect(response.json()).resolves.toEqual({ error: 'RATE_LIMITED' });
  });

  it('keeps auth and command policies separate and bounded', () => {
    expect(AUTH_RATE_LIMIT.scope).toBe('auth');
    expect(WRITE_RATE_LIMIT.scope).toBe('write');
    expect(STAGING_RATE_LIMIT_PROOF_POLICY.scope).toBe('proof');
    expect(AUTH_RATE_LIMIT.limit).toBeLessThan(WRITE_RATE_LIMIT.limit);
    expect(STAGING_RATE_LIMIT_PROOF_POLICY.limit).toBe(AUTH_RATE_LIMIT.limit);
    expect(AUTH_RATE_LIMIT.windowSeconds).toBe(60);
    expect(WRITE_RATE_LIMIT.windowSeconds).toBe(60);
    expect(STAGING_RATE_LIMIT_PROOF_POLICY.windowSeconds).toBe(60);
  });

  it('rejects before the wrapped handler can parse or execute a request', async () => {
    vi.stubEnv('APP_ENV', 'staging');
    mocks.execute.mockResolvedValue([{ allowed: false, remaining: 0, retryAfterSeconds: 60 }]);
    const handler = vi.fn(async (request: Request) => {
      await request.json();
      return new Response('handler reached', { status: 200 });
    });
    const request = new Request('https://fuel.example.test/api/security/rate-limit-proof', {
      method: 'POST',
      body: JSON.stringify({ commandType: 'would-not-run' }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await withPersistentRateLimit(
      handler,
      STAGING_RATE_LIMIT_PROOF_POLICY,
    )(request);

    expect(response.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: 'RATE_LIMITED' });
  });
});
