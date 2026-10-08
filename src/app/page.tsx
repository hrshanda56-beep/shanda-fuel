import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';

import { TodayOverview } from './_overview/today-overview';

export const metadata = {
  title: { absolute: 'Today · Shanda Fuel' },
};

/** Today for the selected station: daily operations and anything needing attention. */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; stationId?: string }>;
}) {
  const { tenantId, stationId } = await searchParams;
  return (
    <AppShell searchPlacement="header">
      <TodayOverview tenantId={tenantId} stationId={stationId} />
    </AppShell>
  );
}
