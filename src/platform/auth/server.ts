import 'server-only';

import { AppError } from '../errors';
import { getAuthProviderName } from './provider';

export const AUTH_SECURITY_POLICY = {
  publicSignUpDisabled: true,
  strongAuthenticationMode: 'fail-closed-until-verified' as const,
  privilegedStepUpRequired: true,
} as const;

let betterAuthPromise: ReturnType<typeof loadBetterAuth> | undefined;

async function loadBetterAuth() {
  const { createBetterAuth } = await import('./better-auth');
  return createBetterAuth();
}

/**
 * Provider-neutral auth boundary. The Better Auth implementation module is
 * loaded only after the selected provider has been verified as BETTER_AUTH.
 */
export async function getAuth() {
  if (getAuthProviderName() !== 'BETTER_AUTH') {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Better Auth is unavailable while another authentication provider is selected',
    );
  }
  betterAuthPromise ??= loadBetterAuth();
  return betterAuthPromise;
}
