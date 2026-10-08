import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import {
  DailyOperationsContextRequired,
  DailyOperationsWorkspace,
  type DailyOperationsContext,
} from '@/modules/forecourt/ui/daily-operations-workspace';
import { OperationsControlRoom } from '@/modules/forecourt/ui/operations-control-room';

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
  const hasStationContext = Boolean(search.tenantId && search.stationId);

  return (
    <AppShell>
      {context ? (
        <DailyOperationsWorkspace context={context} />
      ) : hasStationContext ? (
        <OperationsControlRoom
          context={{
            tenantId: search.tenantId!,
            stationId: search.stationId!,
            businessDayId: search.businessDayId,
          }}
        />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
