import { isOrganisationSlug } from './routes';

/**
 * Pages read the organisation id from `?tenantId=`. A readable address (`?org=<slug>`) is turned
 * into that id once, at the edge, so no page has to know slugs exist. The lookup goes through the
 * authenticated context endpoint with the visitor's own cookies: a slug that is not in the
 * visitor's own organisation list simply does not resolve and the request continues unchanged.
 */
export function pageUrlWithOrganisationId(url: URL, organisationId: string): URL {
  const next = new URL(url);
  next.searchParams.delete('org');
  next.searchParams.set('tenantId', organisationId);
  return next;
}

/** True for page loads that carry a slug and no explicit id (the id form always wins). */
export function carriesOrganisationSlug(url: URL, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return false;
  const slug = url.searchParams.get('org');
  return Boolean(
    slug &&
    isOrganisationSlug(slug) &&
    !url.searchParams.has('tenantId') &&
    !url.searchParams.has('organisationId'),
  );
}

export async function resolveOrganisationSlug(
  origin: string,
  slug: string,
  headers: { cookie?: string | null; authorization?: string | null },
  network: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const lookup = new URL('/api/context', origin);
    lookup.searchParams.set('pathname', '/');
    lookup.searchParams.set('org', slug);
    const response = await network(lookup, {
      headers: {
        ...(headers.cookie ? { cookie: headers.cookie } : {}),
        ...(headers.authorization ? { authorization: headers.authorization } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      data?: { current?: { organisationId?: unknown } | null };
    };
    const id = body.data?.current?.organisationId;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}
