import 'server-only';
import { cache } from 'react';
import { withRequestReadScope } from '../platform/security/request-read-scope';
import type { ContextResolution } from '../modules/context/contracts';
import { AppError } from '../platform/errors';
import { observeError } from '../platform/observability';

import { resolveCurrentContext } from '../modules/context/server';
import type { CurrentContext } from '../modules/context/contracts';
import { resolveTenantExecutionContext } from '../modules/tenancy/server';
import { buildNavigationProjection } from './navigation-projection';
import { syntheticNavigationProjection, type NavigationProjection } from './navigation';
import { allowsE2ENavigationFixture, E2E_NAVIGATION_FIXTURE_HEADER } from './navigation-projection';

export const requestFromHeaders = cache(function requestFromHeaders(
  requestHeaders: Headers,
): Request | null {
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (!host) return null;
  const protocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http';
  return new Request(`${protocol}://${host}/`, {
    headers: new Headers(requestHeaders),
  });
});

async function buildServerNavigationProjection(
  request: Request,
  current: Awaited<ReturnType<typeof resolveCurrentContext>>['current'],
): Promise<readonly NavigationProjection[] | null> {
  if (!current) return null;

  const authority = await resolveTenantExecutionContext({
    request,
    requestedTenantId: current.organisationId,
  });
  const scope = current.stationId
    ? {
        tenantId: current.organisationId,
        scopeType: 'STATION' as const,
        legalEntityId: current.legalEntityId,
        stationId: current.stationId,
      }
    : current.legalEntityId
      ? {
          tenantId: current.organisationId,
          scopeType: 'LEGAL_ENTITY' as const,
          legalEntityId: current.legalEntityId,
        }
      : { tenantId: current.organisationId, scopeType: 'TENANT' as const };

  return buildNavigationProjection({ actor: authority.authorization, scope });
}

/**
 * Resolve the navigation projection at the server authorization boundary.
 * Fail closed for missing session, missing context, or any authorization
 * lookup failure; route data loaders retain their own authorization checks.
 */
export async function getServerNavigationProjection(
  requestHeaders: Headers,
): Promise<readonly NavigationProjection[] | null> {
  if (
    allowsE2ENavigationFixture(
      process.env.APP_ENV,
      requestHeaders.get(E2E_NAVIGATION_FIXTURE_HEADER),
      process.env.NODE_ENV,
    )
  ) {
    return syntheticNavigationProjection;
  }

  const request = requestFromHeaders(requestHeaders);
  if (!request) return null;

  try {
    const resolution = await resolveCurrentContext(request);
    return await buildServerNavigationProjection(request, resolution.current);
  } catch {
    return null;
  }
}

export type ServerShellAccess =
  | { status: 'signed-out' }
  | { status: 'no-workplace' }
  | {
      status: 'ready';
      projection: readonly NavigationProjection[] | null;
      /** The same request-verified scope used to build the projection. */
      current: CurrentContext | null;
      resolution?: ContextResolution;
    };

/**
 * Server-side gate for the authenticated shell. A missing or expired session is
 * `signed-out` (the caller redirects before any product UI is produced); an
 * account with no active organisation is `no-workplace`; any unresolved
 * failed authorization/context lookup throws without rendering product UI.
 * An infrastructure failure must never be misreported as an expired login.
 */
export const getServerShellAccess = cache(async function getServerShellAccess(
  requestHeaders: Headers,
): Promise<ServerShellAccess> {
  if (
    allowsE2ENavigationFixture(
      process.env.APP_ENV,
      requestHeaders.get(E2E_NAVIGATION_FIXTURE_HEADER),
      process.env.NODE_ENV,
    )
  ) {
    return { status: 'ready', projection: syntheticNavigationProjection, current: null };
  }

  const request = requestFromHeaders(requestHeaders);
  if (!request) return { status: 'signed-out' };
  // Clerk is the session authority, not an application cookie-name heuristic.
  // Context resolution verifies Clerk before any identity/membership DB read.
  try {
    return await withRequestReadScope(async () => {
      const resolution = await resolveCurrentContext(request);
      if (resolution.available.organisations.length === 0) return { status: 'no-workplace' };
      if (!resolution.current) throw new AppError('FORBIDDEN', 'A valid work context is required');
      const projection = await buildServerNavigationProjection(request, resolution.current);
      if (projection === null)
        throw new AppError('FORBIDDEN', 'Navigation access could not be verified');
      return { status: 'ready', projection, current: resolution.current, resolution };
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED')
      return { status: 'signed-out' };
    observeError(request, error, 'navigation.access.error');
    throw error;
  }
});
