import { describe, expect, it } from 'vitest';
import { AUTH_SECURITY_POLICY } from './server';

describe('authentication access policy', () => {
  it('disables public self-service signup', () => {
    expect(AUTH_SECURITY_POLICY.publicSignUpDisabled).toBe(true);
  });

  it('keeps strong authentication fail-closed until Better Auth verification is wired', () => {
    expect(AUTH_SECURITY_POLICY.strongAuthenticationMode).toBe('fail-closed-until-verified');
  });
});
