import 'server-only';
import { AppError } from '@/platform/errors';
import { observeError } from '@/platform/observability';
import { Suspense, type ReactNode } from 'react';
import { headers } from 'next/headers';
import {
  AuthorizedAppShell,
  type AuthorizedAppShellProps,
} from '@/design-system/authorized-app-shell';
import {
  getServerShellAccess,
  getServerShellAccessForResolution,
  requestFromHeaders,
} from '@/design-system/navigation-server';
import { AccessDeniedState, ErrorState, LoadingState } from '@/design-system/primitives';
import { withRequestAuthority } from '@/modules/tenancy/request-authority';
import { resolveAvailableContext } from './resolution';
import { contextRoutePolicy, readContextRoute } from './routes';
import { readPersistedContext } from './persistence';
import { PortfolioOverview, SupplierPortfolio } from './portfolio-overview';
import { portfolioArea } from './portfolio';
import type { ContextResolution } from './contracts';

export type PageSearch = Record<string, string | string[] | undefined>;
/** One render owns authorization and reads. Only serialized results cross into the workspace. */
export async function ServerDataPage<T>({
  pathname,
  search = {},
  load,
  render,
  fallback,
  shell = {},
}: {
  pathname: string;
  search?: PageSearch;
  load: (request: Request, resolution: ContextResolution) => Promise<T>;
  render: (data: T, resolution: ContextResolution) => ReactNode;
  fallback: ReactNode;
  shell?: Omit<AuthorizedAppShellProps, 'children' | 'shellAccess'>;
}) {
  const requestHeaders = await headers();
  const access = await getServerShellAccess(requestHeaders);
  const request = requestFromHeaders(requestHeaders);
  if (!request || access.status !== 'ready' || !access.resolution) {
    return (
      <AuthorizedAppShell {...shell} shellAccess={access}>
        {fallback}
      </AuthorizedAppShell>
    );
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  let resolution: ContextResolution;
  try {
    resolution = resolveAvailableContext(
      access.resolution.available,
      readContextRoute(pathname, params),
      contextRoutePolicy(pathname),
      readPersistedContext(request),
    );
  } catch {
    return (
      <AuthorizedAppShell {...shell} shellAccess={access}>
        <ErrorState
          title="Selection needs review"
          message="The selected organisation or station is not available to your account. Open the station selector to review your access."
        />
      </AuthorizedAppShell>
    );
  }
  const pageRequest = new Request(new URL(`${pathname}?${params}`, request.url), {
    headers: request.headers,
  });
  const pageAccess = await getServerShellAccessForResolution(pageRequest, access, resolution);
  if (resolution.current?.allStations && pathname === '/suppliers')
    return (
      <AuthorizedAppShell {...shell} shellAccess={pageAccess}>
        <SupplierPortfolio request={pageRequest} resolution={resolution} />
      </AuthorizedAppShell>
    );
  const area = portfolioArea(pathname);
  if (resolution.current?.allStations && area)
    return (
      <AuthorizedAppShell {...shell} shellAccess={pageAccess}>
        <PortfolioOverview request={pageRequest} resolution={resolution} area={area} />
      </AuthorizedAppShell>
    );
  return (
    <AuthorizedAppShell {...shell} shellAccess={pageAccess}>
      <Suspense
        key={JSON.stringify([pathname, resolution.current, search])}
        fallback={<LoadingState label="Loading page data…" />}
      >
        <PageData request={pageRequest} resolution={resolution} load={load} render={render} />
      </Suspense>
    </AuthorizedAppShell>
  );
}
async function PageData<T>({
  request,
  resolution,
  load,
  render,
}: {
  request: Request;
  resolution: ContextResolution;
  load: (request: Request, resolution: ContextResolution) => Promise<T>;
  render: (data: T, resolution: ContextResolution) => ReactNode;
}) {
  let data: T;
  try {
    data = await withRequestAuthority(() => load(request, resolution));
  } catch (error) {
    observeError(request, error, 'page.data.error');
    if (
      error instanceof AppError &&
      (error.code === 'FORBIDDEN' || error.code === 'UNAUTHENTICATED')
    )
      return <AccessDeniedState />;
    return (
      <ErrorState
        title="Page data unavailable"
        message="The data could not be loaded. Check your work context and reload to try again."
      />
    );
  }
  return render(data, resolution);
}
