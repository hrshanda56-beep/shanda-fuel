import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { getServerShellAccess, requestFromHeaders } from '@/design-system/navigation-server';
import { Icon } from '@/design-system/icons';
import {
  AccessDeniedState,
  Card,
  EmptyState,
  ErrorState,
  StatusBadge,
} from '@/design-system/primitives';
import {
  ACTION_AREAS,
  buildActionCenter,
  type ActionArea,
  type ActionCenter,
} from '@/modules/approvals';
import { loadActionCenterFacts } from '@/modules/approvals/action-center';
import { readContextRoute } from '@/modules/context/routes';
import { resolveCurrentContext } from '@/modules/context/server';

export const metadata = { title: 'Finance' };
export const dynamic = 'force-dynamic';

function ActionList({ center }: { center: ActionCenter }) {
  const countFor = (area: ActionArea) => center.items.filter((item) => item.area === area);
  return (
    <div className="content-grid finance-home">
      {center.unavailable.length > 0 ? (
        <ErrorState
          title="Some items could not be checked"
          message={`${center.unavailable.join(', ')} could not be loaded. Reload to try again. Anything listed below is still correct.`}
        />
      ) : null}
      <dl className="operations-summary content-span" aria-label="Work waiting by area">
        {ACTION_AREAS.map((area) => {
          const items = countFor(area);
          const urgent = items.filter((item) => item.tone === 'attention').length;
          return (
            <div key={area}>
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
            </div>
          );
        })}
      </dl>
      <Card as="section" className="panel content-span" aria-labelledby="finance-actions-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Finance</p>
            <h2 id="finance-actions-heading">Needs your attention</h2>
          </div>
        </div>
        {center.items.length > 0 ? (
          <ul className="finance-list">
            {center.items.map((item) => (
              <li key={item.id}>
                <Link className="finance-row" href={item.href}>
                  <span className="finance-row-text">
                    <span className="finance-row-title">{item.title}</span>
                    <span className="finance-row-detail">{item.detail}</span>
                  </span>
                  <StatusBadge tone={item.tone === 'attention' ? 'warning' : 'informational'}>
                    {item.area}
                  </StatusBadge>
                  <Icon name="chevron-right" className="finance-row-chevron" />
                </Link>
              </li>
            ))}
          </ul>
        ) : center.unavailable.length === 0 ? (
          <EmptyState
            title="All clear"
            message="Nothing is waiting for approval, banking or matching at this station."
          />
        ) : null}
      </Card>
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
  // The shell request is always `/`, which resolves with the all-stations default. Finance work is
  // per station, so resolve the scope again against this page's own route and query.
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') params.set(key, value);
  }
  const request = baseRequest
    ? new Request(new URL(`/finance?${params}`, baseRequest.url), { headers: baseRequest.headers })
    : null;
  let current = access.status === 'ready' ? access.current : null;
  if (request && current) {
    try {
      const resolved = await resolveCurrentContext(request, {
        route: readContextRoute('/finance', params),
      });
      current = resolved.current ?? current;
    } catch {
      // Keep the shell's scope; the page then asks for a station.
    }
  }
  const stationId = current && !current.allStations ? current.stationId : undefined;

  let center: ActionCenter | null = null;
  let failed = false;
  if (allowed && current && stationId && request) {
    try {
      center = buildActionCenter(await loadActionCenterFacts(request, { ...current, stationId }));
    } catch {
      failed = true;
    }
  }

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
      ) : failed || !center ? (
        <ErrorState
          title="Finance could not be loaded"
          message="Reload the page to try again. Nothing has been changed."
        />
      ) : (
        <ActionList center={center} />
      )}
    </AppShell>
  );
}
