import 'server-only';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getServerEnv } from '../config/env';
import { getDatabase } from '../db';
import { authTables } from '../db/schema';
import { AppError } from '../errors';

export const AUTH_SECURITY_POLICY = {
  publicSignUpDisabled: true,
  strongAuthenticationMode: 'fail-closed-until-verified' as const,
} as const;

/**
 * Better Auth owns identity/session mechanics. Memberships and business
 * permissions remain Shanda Fuel concerns and are checked after this layer.
 */
export function getAuth() {
  const env = getServerEnv();
  if (!env.BETTER_AUTH_SECRET) {
    throw new AppError(
      'DEPENDENCY_UNAVAILABLE',
      'BETTER_AUTH_SECRET is required for authentication',
    );
  }

  return betterAuth({
    database: drizzleAdapter(getDatabase(), {
      provider: 'pg',
      schema: authTables,
      schemaName: 'auth',
      transaction: true,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins: [env.APP_URL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: AUTH_SECURITY_POLICY.publicSignUpDisabled,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      additionalFields: {
        revokedAt: { type: 'date', required: false, input: false },
        strongAuthenticatedAt: { type: 'date', required: false, input: false },
        strongAuthenticationExpiresAt: { type: 'date', required: false, input: false },
        strongAuthenticationVerified: { type: 'boolean', required: false, input: false },
        stepUpLevel: { type: 'number', required: false, input: false },
        stepUpExpiresAt: { type: 'date', required: false, input: false },
      },
    },
    advanced: {
      cookiePrefix: 'shanda-fuel',
      useSecureCookies: env.APP_ENV === 'production',
      database: {
        generateId: 'uuid',
      },
    },
  });
}
