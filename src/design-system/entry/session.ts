import 'server-only';

import { requestFromHeaders } from '../navigation-server';
import { resolveAuthenticatedActor } from '@/modules/identity';

/**
 * Cheap, fail-soft check used only to keep signed-in people off the sign-in
 * page. It is not an authorisation boundary: every protected page and data
 * loader still resolves the actor and membership server-side. A request with
 * no session cookie never touches the database.
 */
export async function hasActiveSession(requestHeaders: Headers): Promise<boolean> {
  if (!(requestHeaders.get('cookie') ?? '').includes('session_token')) return false;
  const request = requestFromHeaders(requestHeaders);
  if (!request) return false;
  try {
    return (await resolveAuthenticatedActor(request)) !== null;
  } catch {
    return false;
  }
}
