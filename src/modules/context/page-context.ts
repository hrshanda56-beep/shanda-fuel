import type { ContextResolution } from './contracts';
import { readPersistedContext } from './persistence';
import { resolveAvailableContext } from './resolution';
import { contextRoutePolicy, readContextRoute } from './routes';

/**
 * The page's own station or organisation choice, worked out from what the shell has already
 * loaded for this request instead of asking the database a second time. `resolveCurrentContext`
 * is exactly "discover what the person may use, then choose from it"; the discovery is the part
 * that costs round trips, and the shell has done it, so the choice is made again here from the
 * shell's list. The same rules apply (route, policy, saved choice), and what the person may use is
 * still only what the shell verified: nothing is widened.
 *
 * Returns `null` when the shell has nothing to reuse (signed out, no workplace, or an e2e
 * fixture); the caller then falls back to `resolveCurrentContext`. Throws what
 * `resolveCurrentContext` would throw for a selection the person may not use.
 */
export function contextFromShellAccess(
  access: { status: string; resolution?: ContextResolution },
  request: Request,
  pathname: string,
  params: URLSearchParams,
): ContextResolution | null {
  if (access.status !== 'ready' || !access.resolution) return null;
  return resolveAvailableContext(
    access.resolution.available,
    readContextRoute(pathname, params),
    contextRoutePolicy(pathname),
    readPersistedContext(request),
  );
}
