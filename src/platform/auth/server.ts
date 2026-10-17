import 'server-only';

export const AUTH_SECURITY_POLICY = {
  publicSignUpDisabled: true,
  strongAuthenticationMode: 'fail-closed-until-verified' as const,
  privilegedStepUpRequired: true,
} as const;
