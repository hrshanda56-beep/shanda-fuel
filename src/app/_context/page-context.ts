import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  allowsE2ENavigationFixture,
  E2E_NAVIGATION_FIXTURE_HEADER,
} from '@/design-system/navigation-projection';
import { resolveCurrentContext } from '@/modules/context/server';
import { AppError } from '@/platform/errors';

type SearchParams = Record<string, string | string[] | undefined>;

export type PageContext = Readonly<{
  tenantId: string;
  stationId?: string;
  legalEntityId?: string;
}>;

const ORIGIN = 'http://shanda-fuel.local';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The work context for a server page. An explicit URL (query or station path) wins; otherwise the
 * saved selection (the shell's station selector) is used, so a page never asks for a station the
 * header already shows. Returns null only when the signed-in account has no usable context.
 */
export async function resolvePageContext(
  pathname: string,
  search: SearchParams,
  options: Readonly<{ needsStation?: boolean }> = {},
): Promise<PageContext | null> {
  const pathStation = pathname.match(/^\/stations\/([^/]+)/)?.[1];
  const tenantId = first(search.tenantId) ?? first(search.organisationId);
  const stationId = pathStation ?? first(search.stationId);
  const legalEntityId = first(search.legalEntityId);
  if (tenantId && (stationId || !options.needsStation)) {
    return {
      tenantId,
      ...(stationId ? { stationId } : {}),
      ...(legalEntityId ? { legalEntityId } : {}),
    };
  }

  const requestHeaders = await headers();
  // The synthetic browser-test fixture has no session; it renders with whatever the URL carries.
  if (
    allowsE2ENavigationFixture(
      process.env.APP_ENV,
      requestHeaders.get(E2E_NAVIGATION_FIXTURE_HEADER),
      process.env.NODE_ENV,
    )
  ) {
    return null;
  }

  const url = new URL(pathname, ORIGIN);
  for (const [key, value] of Object.entries(search)) {
    const single = first(value);
    if (single !== undefined) url.searchParams.set(key, single);
  }
  try {
    const resolution = await resolveCurrentContext(new Request(url, { headers: requestHeaders }));
    const current = resolution.current;
    if (!current) return null;
    const station = pathStation ?? current.stationId;
    if (options.needsStation && (!station || current.allStations)) return null;
    return {
      tenantId: current.organisationId,
      ...(station ? { stationId: station } : {}),
      ...(current.legalEntityId ? { legalEntityId: current.legalEntityId } : {}),
    };
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED') redirect('/login');
    return null;
  }
}
