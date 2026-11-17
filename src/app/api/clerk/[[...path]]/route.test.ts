import { afterEach, describe, expect, it, vi } from 'vitest';

const forwarded = vi.hoisted(() => vi.fn(async () => new Response('from clerk')));
vi.mock('@clerk/nextjs/server', () => ({
  createFrontendApiProxyHandlers: () => ({
    GET: forwarded,
    POST: forwarded,
    PUT: forwarded,
    DELETE: forwarded,
    PATCH: forwarded,
  }),
}));

import { GET } from './route';

const host = Buffer.from('calm-fox-1.clerk.accounts.dev$').toString('base64');

describe('the Clerk proxy route (A7)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    forwarded.mockClear();
  });

  it('says the keys are wrong, in plain words, instead of forwarding to Clerk', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', `pk_test_${host}`);
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_live_abcdefghijklmnop');
    const response = await GET(new Request('http://localhost/api/clerk/v1/client'));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('CLERK_NOT_CONFIGURED');
    expect(body.message).toContain('same Clerk instance');
    expect(JSON.stringify(body)).not.toContain('abcdefghijklmnop');
    expect(forwarded).not.toHaveBeenCalled();
  });

  it('forwards to Clerk when the keys are a matching pair', async () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', `pk_test_${host}`);
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_abcdefghijklmnop');
    const response = await GET(new Request('http://localhost/api/clerk/v1/client'));
    expect(await response.text()).toBe('from clerk');
    expect(forwarded).toHaveBeenCalledOnce();
  });
});
