import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getServerShellAccess } from '@/design-system/navigation-server';
import { ServerDailyOperations } from '@/modules/forecourt/server-daily';
import { ServerOperationsOverview } from '@/modules/forecourt/server-overview';
import { type DailyOperationsContext } from '@/modules/forecourt/ui/daily-operations-workspace';

export const metadata = {
  title: 'Daily operations',
};

export default async function DailyOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tenantId?: string;
    stationId?: string;
    businessDayId?: string;
    shiftId?: string;
    reconciliationId?: string;
  }>;
}) {
  const search = await searchParams;
  // Running the day is not finance work: that person goes to the Finance overview instead.
  const access = await getServerShellAccess(await headers());
  if (
    access.status === 'ready' &&
    access.projection?.some((entry) => entry.key === 'finance-home' && entry.home)
  ) {
    const query = new URLSearchParams();
    for (const key of ['tenantId', 'stationId'] as const) {
      const value = search[key];
      if (value) query.set(key, value);
    }
    redirect(query.size > 0 ? `/finance?${query}` : '/finance');
  }
  const hasContext = Boolean(
    search.tenantId && search.stationId && search.businessDayId && search.shiftId,
  );
  const context: DailyOperationsContext | undefined = hasContext
    ? {
        tenantId: search.tenantId!,
        stationId: search.stationId!,
        businessDayId: search.businessDayId!,
        shiftId: search.shiftId!,
        reconciliationId: search.reconciliationId,
      }
    : undefined;
  if (!context) return <ServerOperationsOverview search={search} />;
  return <ServerDailyOperations search={search} context={context} />;
}
