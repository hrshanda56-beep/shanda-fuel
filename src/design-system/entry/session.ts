import 'server-only';

import { requestFromHeaders } from '../navigation-server';
import { resolveAuthenticatedActor } from '@/modules/identity';
import { readAuthenticatedAccount } from '@/modules/identity/account';
import { hasProviderSessionCookie } from './session-cookie';

/**
 * Cheap, fail-soft check used only to keep signed-in people off the sign-in
 * page. It is not an authorisation boundary: every protected page and data
 * loader still resolves the actor and membership server-side. A request with
 * no session cookie never touches the database.
 */
export async function hasActiveSession(requestHeaders: Headers): Promise<boolean> {
  if (!hasProviderSessionCookie(requestHeaders)) return false;
  const request = requestFromHeaders(requestHeaders);
  if (!request) return false;
  try {
    return (await resolveAuthenticatedActor(request)) !== null;
  } catch {
    return false;
  }
}

/**
 * The email of the signed-in account, or null when nobody is signed in or it cannot be read.
 * Lets the invitation page tell a wrong-account visitor before acceptance fails opaquely.
 */
export async function signedInEmail(requestHeaders: Headers): Promise<string | null> {
  if (!hasProviderSessionCookie(requestHeaders)) return null;
  const request = requestFromHeaders(requestHeaders);
  if (!request) return null;
  try {
    return (await readAuthenticatedAccount(request)).user.email?.trim().toLowerCase() ?? null;
  } catch {
    return null;
  }
}
