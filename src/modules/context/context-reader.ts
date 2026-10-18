import type { ContextResolution } from './contracts';
import { resolveAvailableContext } from './resolution';
import { contextRoutePolicy, readContextRoute } from './routes';

/** A render-owned snapshot, never a module/global authorization cache. */
export function createContextReader(
  initial: ContextResolution | undefined,
  network: typeof fetch = fetch,
): typeof fetch {
  const pending = new Map<string, Promise<Response>>();
  return async (input, init) => {
    const url = typeof input === 'string' ? new URL(input, 'http://context.local') : null;
    if (
      !url ||
      url.pathname !== '/api/context' ||
      (init?.method ?? 'GET').toUpperCase() !== 'GET'
    ) {
      return network(input, init);
    }
    init?.signal?.throwIfAborted();
    if (initial && init?.cache !== 'reload') {
      try {
        const pathname = url.searchParams.get('pathname') ?? '/';
        const route = readContextRoute(pathname, url.searchParams);
        return Response.json({
          data: resolveAvailableContext(initial.available, route, contextRoutePolicy(pathname), {
            selection: initial.current,
            invalid: initial.persistedContextInvalid,
          }),
        });
      } catch {
        return Response.json(
          { message: 'The requested work context is not available.' },
          { status: 403 },
        );
      }
    }
    url.searchParams.sort();
    const key = url.pathname + url.search;
    let request = pending.get(key);
    if (!request || init?.cache === 'reload') {
      // One consumer unmounting must not abort another consumer's shared read.
      request = network(input, { ...init, signal: undefined })
        .then((response) => {
          if (!response.ok) pending.delete(key);
          return response;
        })
        .catch((error: unknown) => {
          pending.delete(key);
          throw error;
        });
      pending.set(key, request);
    }
    const response = await request;
    init?.signal?.throwIfAborted();
    return response.clone();
  };
}
