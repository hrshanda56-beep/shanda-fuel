import { describe, expect, it } from 'vitest';
import { AUTH_SECURITY_POLICY, buildTwoFactorPlugin } from './server';

describe('authentication access policy', () => {
  it('disables public self-service signup', () => {
    expect(AUTH_SECURITY_POLICY.publicSignUpDisabled).toBe(true);
  });

  it('keeps strong authentication fail-closed until provider verification succeeds', () => {
    expect(AUTH_SECURITY_POLICY.strongAuthenticationMode).toBe('fail-closed-until-verified');
  });

  it('keeps privileged step-up required', () => {
    expect(AUTH_SECURITY_POLICY.privilegedStepUpRequired).toBe(true);
  });

  it('removes only normal-login MFA enforcement when explicitly disabled', () => {
    const plugin = buildTwoFactorPlugin(false);

    expect(plugin.hooks.after).toEqual([]);
    expect(plugin.endpoints.verifyTOTP).toBeDefined();
    expect(plugin.endpoints.enableTwoFactor).toBeDefined();
    expect(plugin.endpoints.verifyBackupCode).toBeDefined();
  });

  it('retains normal-login MFA enforcement when enabled', () => {
    const plugin = buildTwoFactorPlugin(true);

    expect(plugin.hooks.after).toHaveLength(1);
    expect(plugin.endpoints.verifyTOTP).toBeDefined();
    expect(plugin.endpoints.enableTwoFactor).toBeDefined();
  });
});
