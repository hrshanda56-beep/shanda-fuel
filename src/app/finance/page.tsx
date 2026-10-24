import { buildContextHref } from '@/modules/context/routes';
import { PortfolioOverview } from '@/modules/context/portfolio-overview';
import { getServerShellAccessForResolution } from '@/design-system/navigation-server';
import { requireAuthenticatedActor } from '@/modules/identity';
import { Suspense } from 'react';
import type { ContextResolution } from '@/modules/context/contracts';
import type { CurrentContext } from '@/modules/context/contracts';
import { resolveAvailableContext } from '@/modules/context/resolution';
import { contextRoutePolicy } from '@/modules/context/routes';
import { readPersistedContext } from '@/modules/context/persistence';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { getServerShellAccess, requestFromHeaders } from '@/design-system/navigation-server';
import { TableScrollRegion } from '@/design-system/table';
import { Icon } from '@/design-system/icons';
import {
  AccessDeniedState,
  LoadingState,
  Card,
  EmptyState,
  ErrorState,
  StatusBadge,
} from '@/design-system/primitives';
import {
  ACTION_AREAS,
  buildActionCenter,
  type ActionArea,
  type ActionItem,
  type ActionCenter,
} from '@/modules/approvals';
import { loadActionCenterFacts } from '@/modules/approvals/action-center';
import { readContextRoute } from '@/modules/context/routes';
import { resolveCurrentContext } from '@/modules/context/server';

export const metadata = { title: 'Finance' };
export const dynamic = 'force-dynamic';

function ActionTable({
  items,
  current,
}: {
  items: readonly ActionItem[];
  current: CurrentContext;
}) {
  return (
    <Card
      as="section"
      className="panel content-span finance-panel"
      aria-labelledby="finance-actions-heading"
    >
      <h2 id="finance-actions-heading" className="finance-table-title">
        Needs your attention
        <span className="finance-table-count">{items.length}</span>
      </h2>
      <TableScrollRegion label="Finance work waiting">
        <table className="data-table finance-table">
          <caption className="sr-only">Finance work waiting</caption>
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Area</th>
              <th scope="col">Priority</th>
              <th scope="col">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <th scope="row">
                  <Link
                    className="finance-table-link"
                    href={
                      item.href.startsWith('/') && !item.href.includes('?')
                        ? buildContextHref(item.href, '', current)
                        : item.href
                    }
                  >
                    {item.title}
                  </Link>
                  <span className="finance-table-detail">{item.detail}</span>
                </th>
                <td data-label="Area">{item.area}</td>
                <td data-label="Priority">
                  <StatusBadge tone={item.tone === 'attention' ? 'warning' : 'informational'}>
                    {item.tone === 'attention' ? 'Needs action' : 'For information'}
                  </StatusBadge>
                </td>
                <td className="finance-table-go" aria-hidden="true">
                  <Icon name="chevron-right" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
    </Card>
  );
}

function ActionList({
  center,
  stationId,
  current,
}: {
  center: ActionCenter;
  stationId: string;
  current: CurrentContext;
}) {
  const station = `/stations/${encodeURIComponent(stationId)}`;
  const areaHref: Record<ActionArea, string> = {
    Approvals: '/operations/reconciliations',
    Banking: `${station}/cash`,
    Settlements: `${station}/settlements`,
    Payables: '/suppliers',
    Receivables: '/customers',
  };
  const countFor = (area: ActionArea) => center.items.filter((item) => item.area === area);
  return (
    <div className="content-grid finance-home">
      {center.unavailable.length > 0 ? (
        <ErrorState
          title="Some items could not be checked"
          message={`${center.unavailable.join(', ')} could not be loaded. Reload to try again. Anything listed below is still correct.`}
        />
      ) : null}
      <dl
        className="operations-summary finance-tiles content-span"
        aria-label="Work waiting by area"
      >
        {ACTION_AREAS.map((area) => {
          const items = countFor(area);
          const urgent = items.filter((item) => item.tone === 'attention').length;
          return (
            <Link
              key={area}
              className="finance-tile"
              href={buildContextHref(areaHref[area], '', current)}
            >
              <dt>{area}</dt>
              <dd>
                {items.length}
                <span className="operations-summary-note">
                  {items.length === 0
                    ? 'Nothing waiting'
                    : urgent > 0
                      ? `${urgent} need${urgent === 1 ? 's' : ''} attention`
                      : 'For information'}
                </span>
              </dd>
            </Link>
          );
        })}
      </dl>
      {center.items.length > 0 ? (
        <ActionTable items={center.items} current={current} />
      ) : center.unavailable.length === 0 ? (
        <Card as="section" className="panel content-span">
          <EmptyState
            title="All clear"
            message="Nothing is waiting for approval, banking or matching at this station."
          />
        </Card>
      ) : null}
    </div>
  );
}

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
  try {
    const actor = await requireAuthenticatedActor(request);
    center = buildActionCenter(await loadActionCenterFacts(request, current, actor));
  } catch {
    // Rendering remains outside the data-loading try/catch.
  }
  if (!center) {
    return (
      <ErrorState
        title="Finance could not be loaded"
        message="Reload the page to try again. Nothing has been changed."
      />
    );
  }
  return <ActionList center={center} stationId={current.stationId} current={current} />;
}
