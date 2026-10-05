import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
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
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      breadcrumbs={[{ label: 'Operations' }, { label: 'Daily workspace' }]}
    >
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
