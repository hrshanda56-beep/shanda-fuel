import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasProviderSessionCookie } from './session-cookie';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('provider session cookie detection', () => {
  it('recognizes Clerk sessions without accepting the Better Auth cookie', () => {
    vi.stubEnv('AUTH_PROVIDER', 'CLERK');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_clerk_fixture');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_clerk_fixture');
    expect(hasProviderSessionCookie(new Headers({ cookie: '__session=opaque' }))).toBe(true);
    expect(hasProviderSessionCookie(new Headers({ cookie: 'session_token=opaque' }))).toBe(false);
  });

  it('recognizes Better Auth sessions without accepting the Clerk cookie', () => {
    vi.stubEnv('AUTH_PROVIDER', 'BETTER_AUTH');
    expect(hasProviderSessionCookie(new Headers({ cookie: 'session_token=opaque' }))).toBe(true);
    expect(hasProviderSessionCookie(new Headers({ cookie: '__session=opaque' }))).toBe(false);
  });
});
