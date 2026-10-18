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
