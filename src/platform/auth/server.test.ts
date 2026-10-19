import { describe, expect, it } from 'vitest';
import { AUTH_SECURITY_POLICY } from './server';
describe('authentication access policy', () => {
  it('requires verified assurance and privileged step-up and disables signup', () => {
    expect(AUTH_SECURITY_POLICY).toEqual({
      publicSignUpDisabled: true,
      strongAuthenticationMode: 'fail-closed-until-verified',
      privilegedStepUpRequired: true,
    });
  });
});
