import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./better-auth', () => ({
  createBetterAuth: vi.fn(() => ({ provider: 'better-auth-test-double' })),
}));

import { getAuth } from './server';
import { assertAuthProviderName, getAuthProviderName } from './provider';
import { createBetterAuth } from './better-auth';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('provider selection', () => {
  it('accepts only the two explicit providers', () => {
    expect(assertAuthProviderName('BETTER_AUTH')).toBe('BETTER_AUTH');
    expect(assertAuthProviderName('CLERK')).toBe('CLERK');
    expect(() => assertAuthProviderName(undefined)).toThrow('provider configuration is invalid');
    expect(() => assertAuthProviderName('fallback')).toThrow('provider configuration is invalid');
  });

  it('fails closed when the selected provider is missing', () => {
    vi.stubEnv('AUTH_PROVIDER', '');
    expect(() => getAuthProviderName()).toThrow('provider configuration is invalid');
  });

  it('does not initialize Better Auth while Clerk is selected', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'CLERK');
    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_fake_clerk_fixture');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_fake_clerk_fixture');

    await expect(getAuth()).rejects.toThrow('Better Auth is unavailable');
    expect(createBetterAuth).not.toHaveBeenCalled();
  });

  it('initializes Better Auth only after Better Auth is selected', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'BETTER_AUTH');

    await expect(getAuth()).resolves.toEqual({ provider: 'better-auth-test-double' });
    expect(createBetterAuth).toHaveBeenCalledOnce();
  });
});
