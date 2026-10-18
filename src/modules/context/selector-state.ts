import type { ContextResolution } from './contracts';
import { resolveAvailableContext } from './resolution';
import { contextRoutePolicy, readContextRoute } from './routes';
/** Presentation snapshot only; API and command authorization remain authoritative. */
export function selectionForDisplay(
  snapshot: ContextResolution | undefined,
  pathname: string,
  search: string,
): ContextResolution | undefined {
  if (!snapshot) return undefined;
  try {
    return resolveAvailableContext(
      snapshot.available,
      readContextRoute(pathname, new URLSearchParams(search)),
      contextRoutePolicy(pathname),
      { selection: snapshot.current, invalid: snapshot.persistedContextInvalid },
    );
  } catch {
    return undefined;
  }
}
export function contextReadFailure(status?: number) {
  if (status === 401)
    return {
      kind: 'session' as const,
      title: 'Sign in again',
      message: 'Your session has expired. Sign in to continue.',
    };
  if (status === 403)
    return {
      kind: 'access' as const,
      title: 'Review station access',
      message:
        'Your access to the selected organisation or station could not be verified. Refresh your access or contact your administrator.',
    };
  return {
    kind: 'connection' as const,
    title: 'Could not refresh stations',
    message: 'Your selection has been kept. Check your connection and try again.',
  };
}
