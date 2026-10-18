import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { getServerShellAccess, requestFromHeaders } from '@/design-system/navigation-server';
import { Icon } from '@/design-system/icons';
import { PageHeader } from '@/design-system/layout';
import { AccessDeniedState, EmptyState, ErrorState } from '@/design-system/primitives';
import { buildActionCenter, type ActionCenter } from '@/modules/approvals';
import { loadActionCenterFacts } from '@/modules/approvals/action-center';

export const metadata = { title: 'Finance' };
export const dynamic = 'force-dynamic';

function ActionList({ center }: { center: ActionCenter }) {
  return (
    <div className="today">
      {center.unavailable.length > 0 ? (
        <ErrorState
          title="Some items could not be checked"
          message={`${center.unavailable.join(', ')} could not be loaded. Reload to try again. Anything listed below is still correct.`}
        />
      ) : null}
      <section className="today-section" aria-labelledby="finance-actions-heading">
        <h2 id="finance-actions-heading">Needs your attention</h2>
        {center.items.length > 0 ? (
          <ul className="today-list">
            {center.items.map((item) => (
              <li key={item.id}>
                <Link className="today-row" href={item.href}>
                  <span className="today-row-text">
                    <span className="today-row-title">{item.title}</span>
                    <span className="today-row-detail">{item.detail}</span>
                  </span>
                  <Icon name="chevron-right" className="today-row-chevron" />
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
      </section>
    </div>
  );
}

/**
 * Finance home: the work that needs a finance person, each item linking to the screen that
 * resolves it. Everything is read through the same per-module authorisation as those screens.
 */
export default async function FinancePage() {
  const requestHeaders = await headers();
  const access = await getServerShellAccess(requestHeaders);
  if (access.status === 'signed-out') redirect('/login');

  const current = access.status === 'ready' ? access.current : null;
  const allowed =
    access.status === 'ready' &&
    access.projection?.some((entry) => entry.key === 'finance-home' && entry.visible);
  const request = requestFromHeaders(requestHeaders);
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
    <AppShell shellAccess={access}>
      <PageHeader
        title="Finance"
        description="Approvals, banking, settlements and payables that need attention."
      />
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
