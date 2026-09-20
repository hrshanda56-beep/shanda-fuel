import 'server-only';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getServerEnv } from '@/platform/config/env';
import { getDatabase } from '@/platform/db';
import { AppError } from '@/platform/errors';

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
      schemaName: 'auth',
      transaction: true,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins: [env.APP_URL],
    emailAndPassword: { enabled: true },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
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
