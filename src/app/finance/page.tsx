import { PortfolioOverview } from '@/modules/context/portfolio-overview';
import { getServerShellAccessForResolution } from '@/design-system/navigation-server';
import { requireAuthenticatedActor } from '@/modules/identity';
import { Suspense } from 'react';
import type { ContextResolution } from '@/modules/context/contracts';
import type { CurrentContext } from '@/modules/context/contracts';
import { resolveAvailableContext } from '@/modules/context/resolution';
import { contextRoutePolicy } from '@/modules/context/routes';
import { readPersistedContext } from '@/modules/context/persistence';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { getServerShellAccess, requestFromHeaders } from '@/design-system/navigation-server';
import {
  AccessDeniedState,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/design-system/primitives';
import { buildActionCenter, type ActionCenter, type ActionCenterFacts } from '@/modules/approvals';
import { FinanceHome } from './finance-home';
import { loadActionCenterFacts } from '@/modules/approvals/action-center';
import { readContextRoute } from '@/modules/context/routes';
import { resolveCurrentContext } from '@/modules/context/server';

export const metadata = { title: 'Finance' };
export const dynamic = 'force-dynamic';

/**
 * Finance home: the work that needs a finance person, each item linking to the screen that
 * resolves it. Everything is read through the same per-module authorisation as those screens.
 */
export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requestHeaders = await headers();
  const access = await getServerShellAccess(requestHeaders);
  if (access.status === 'signed-out') redirect('/login');

  const allowed =
    access.status === 'ready' &&
    access.projection?.some((entry) => entry.key === 'finance-home' && entry.visible);
  const baseRequest = requestFromHeaders(requestHeaders);
  // Resolve Finance's explicit URL scope against the same authorized context tree as the shell.
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') params.set(key, value);
  }
  const request = baseRequest
    ? new Request(new URL(`/finance?${params}`, baseRequest.url), { headers: baseRequest.headers })
    : null;
  let current = access.status === 'ready' ? access.current : null;
  let portfolioResolution: ContextResolution | null = null;
  if (request && current) {
    try {
      const route = readContextRoute('/finance', params);
      const resolved =
        access.status === 'ready' && access.resolution
          ? resolveAvailableContext(
              access.resolution.available,
              route,
              contextRoutePolicy('/finance'),
              readPersistedContext(request),
            )
          : await resolveCurrentContext(request, { route });
      current = resolved.current ?? current;
      if (current?.allStations) portfolioResolution = resolved;
    } catch {
      // Keep the shell's scope; the page then asks for a station.
    }
  }
  if (allowed && portfolioResolution && request && access.status === 'ready') {
    const pageAccess = await getServerShellAccessForResolution(
      request,
      access,
      portfolioResolution,
    );
    return (
      <AppShell shellAccess={pageAccess}>
        <PortfolioOverview request={request} resolution={portfolioResolution} area="finance" />
      </AppShell>
    );
  }
  const stationId = current && !current.allStations ? current.stationId : undefined;

  return (
    <AppShell
      shellAccess={access}
      pageSubtitle="Approvals, banking, settlements and payables that need attention."
    >
      {!allowed ? (
        <AccessDeniedState />
      ) : !stationId ? (
        <EmptyState
          title="Choose a station"
          message="Finance work is shown one station at a time. Use the context selector to pick a station."
        />
      ) : request && current ? (
        <Suspense fallback={<LoadingState label="Loading finance work…" />}>
          <FinanceWork request={request} current={{ ...current, stationId }} />
        </Suspense>
      ) : (
        <ErrorState title="Finance could not be loaded" message="Reload the page to try again." />
      )}
    </AppShell>
  );
}

async function FinanceWork({
  request,
  current,
}: {
  request: Request;
  current: CurrentContext & { stationId: string };
}) {
  let center: ActionCenter | null = null;
  let facts: ActionCenterFacts | null = null;
  try {
    const actor = await requireAuthenticatedActor(request);
    facts = await loadActionCenterFacts(request, current, actor);
    center = buildActionCenter(facts);
  } catch {
    // Rendering remains outside the data-loading try/catch.
  }
  if (!center || !facts) {
    return (
      <ErrorState
        title="Finance could not be loaded"
        message="Reload the page to try again. Nothing has been changed."
      />
    );
  }
  return <FinanceHome center={center} facts={facts} current={current} />;
}
