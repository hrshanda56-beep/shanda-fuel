/**
 * Local-development sign-in that never contacts Clerk (DEC-050).
 *
 * This is not a second auth provider: it only picks which already-provisioned
 * identity a local browser acts as. Every guard below must hold, so a deployed
 * build (or one pointed at a non-local database) can never enable it. This
 * module is deliberately free of server-only imports so the proxy can use it.
 */
export const DEV_BYPASS_COOKIE = 'shanda_dev_user';

function isLoopbackDatabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function isLocalDevBypassEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DEV_AUTH_BYPASS !== '1') return false;
  if (env.NODE_ENV === 'production') return false;
  if ((env.APP_ENV ?? 'local') !== 'local') return false;
  if (env.VERCEL || env.VERCEL_ENV || env.CI === 'true') return false;
  // Both connection strings must be local; an unset URL is not proof of safety.
  if (!isLoopbackDatabase(env.DATABASE_URL)) return false;
  if (env.DATABASE_DIRECT_URL && !isLoopbackDatabase(env.DATABASE_DIRECT_URL)) return false;
  return true;
}

export type DevBypassUser = { label: string; providerUserId: string };

/** `DEV_AUTH_BYPASS_USERS="Local Owner:user_abc,Local Finance:user_def"` */
export function devBypassUsers(env: NodeJS.ProcessEnv = process.env): DevBypassUser[] {
  if (!isLocalDevBypassEnabled(env)) return [];
  return (env.DEV_AUTH_BYPASS_USERS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const at = entry.lastIndexOf(':');
      if (at <= 0) return [];
      return [{ label: entry.slice(0, at).trim(), providerUserId: entry.slice(at + 1).trim() }];
    });
}

export function readDevBypassCookie(cookieHeader: string | null): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === DEV_BYPASS_COOKIE) return decodeURIComponent(rest.join('=')) || null;
  }
  return null;
}
