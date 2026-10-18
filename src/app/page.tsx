import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { getServerShellAccess } from '@/design-system/navigation-server';

import { TodayOverview } from './_overview/today-overview';
import { dashboardScopeFromCurrentContext } from './_overview/today-overview-model';

export const metadata = {
  title: { absolute: 'Dashboard · Shanda Fuel' },
};

/** Today for the selected station: daily operations and anything needing attention. */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; legalEntityId?: string; stationId?: string }>;
}) {
  const { tenantId, legalEntityId, stationId } = await searchParams;

  // Someone whose permissions are only shift and meter work lands on My Shift
  // instead of an empty management dashboard. Decided from resolved permissions.
  const access = await getServerShellAccess(await headers());
  if (
    access.status === 'ready' &&
    access.projection?.some((entry) => entry.key === 'my-shift' && entry.visible)
  ) {
    const query = new URLSearchParams();
    if (tenantId) query.set('tenantId', tenantId);
    if (legalEntityId) query.set('legalEntityId', legalEntityId);
    if (stationId) query.set('stationId', stationId);
    const search = query.toString();
    redirect(search ? `/my-shift?${search}` : '/my-shift');
  }

  // Finance sign-off work without running the day lands on the Finance overview.
  if (
    access.status === 'ready' &&
    access.projection?.some((entry) => entry.key === 'finance-home' && entry.visible && entry.home)
  ) {
    const query = new URLSearchParams();
    if (tenantId) query.set('tenantId', tenantId);
    if (legalEntityId) query.set('legalEntityId', legalEntityId);
    if (stationId) query.set('stationId', stationId);
    const search = query.toString();
    redirect(search ? `/finance?${search}` : '/finance');
  }

  const initialContext =
    access.status === 'ready' && !tenantId
      ? dashboardScopeFromCurrentContext(access.current)
      : undefined;

  return (
    <AppShell searchPlacement="header" shellAccess={access}>
      <TodayOverview tenantId={tenantId} stationId={stationId} initialContext={initialContext} />
    </AppShell>
  );
}
