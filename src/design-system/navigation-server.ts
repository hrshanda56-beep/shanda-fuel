import 'server-only';

import { resolveCurrentContext } from '../modules/context/server';
import type { CurrentContext } from '../modules/context/contracts';
import { resolveTenantExecutionContext } from '../modules/tenancy/server';
import { hasProviderSessionCookie } from './entry/session-cookie';
import { buildNavigationProjection } from './navigation-projection';
import { syntheticNavigationProjection, type NavigationProjection } from './navigation';
import { allowsE2ENavigationFixture, E2E_NAVIGATION_FIXTURE_HEADER } from './navigation-projection';

export function requestFromHeaders(requestHeaders: Headers): Request | null {
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (!host) return null;
  const protocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http';
  return new Request(`${protocol}://${host}/`, {
    headers: new Headers(requestHeaders),
  });
}

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
    };

/**
 * Server-side gate for the authenticated shell. A missing or expired session is
 * `signed-out` (the caller redirects before any product UI is produced); an
 * account with no active organisation is `no-workplace`; any unresolved
 * navigation-context lookup is also `signed-out` so the shell never renders
 * without verified authorization.
 */
export async function getServerShellAccess(requestHeaders: Headers): Promise<ServerShellAccess> {
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
  // No session cookie means signed out, whatever the database is doing. This
  // keeps a lookup failure from ever rendering product UI for a visitor.
  if (!hasProviderSessionCookie(requestHeaders)) return { status: 'signed-out' };

  try {
    const resolution = await resolveCurrentContext(request);
    if (resolution.available.organisations.length === 0) return { status: 'no-workplace' };
    if (!resolution.current) return { status: 'signed-out' };
    const projection = await buildServerNavigationProjection(request, resolution.current);
    if (projection === null) return { status: 'signed-out' };
    return { status: 'ready', projection, current: resolution.current };
  } catch {
    // Any unresolved session/context/authorization error must fail closed.
    // The shell redirects signed-out users and never renders product UI when
    // access cannot be verified.
    return { status: 'signed-out' };
  }
}
