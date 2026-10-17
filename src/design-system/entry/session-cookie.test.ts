import { describe, expect, it } from 'vitest';
import { hasProviderSessionCookie } from './session-cookie';

describe('Clerk session cookie detection', () => {
  it('recognizes the exact Clerk cookie among other cookies', () => {
    expect(hasProviderSessionCookie(new Headers({ cookie: 'theme=dark; __session=opaque' }))).toBe(
      true,
    );
  });

  it.each([
    '',
    'shanda-fuel.session_token=opaque',
    '__Secure-shanda-fuel.session_token=opaque',
    'session_token=opaque',
    '__session_extra=opaque',
  ])('rejects absent or non-Clerk cookies: %s', (cookie) => {
    expect(hasProviderSessionCookie(new Headers({ cookie }))).toBe(false);
  });
});
