import 'server-only';

import { resolveCurrentContext } from '../modules/context/server';
import { resolveTenantExecutionContext } from '../modules/tenancy/server';
import { buildNavigationProjection } from './navigation-projection';
import { syntheticNavigationProjection, type NavigationProjection } from './navigation';
import { allowsE2ENavigationFixture, E2E_NAVIGATION_FIXTURE_HEADER } from './navigation-projection';

function requestFromHeaders(requestHeaders: Headers): Request | null {
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (!host) return null;
  const protocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http';
  return new Request(`${protocol}://${host}/`, {
    headers: new Headers(requestHeaders),
  });
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
    )
  ) {
    return syntheticNavigationProjection;
  }

  const request = requestFromHeaders(requestHeaders);
  if (!request) return null;

  try {
    const resolution = await resolveCurrentContext(request);
    const current = resolution.current;
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
  } catch {
    return null;
  }
}
