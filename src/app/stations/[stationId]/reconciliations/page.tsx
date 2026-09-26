import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { DailyOperationsContextRequired } from '@/modules/forecourt/ui/daily-operations-workspace';
import { OperationsControlRoom } from '@/modules/forecourt/ui/operations-control-room';

export default async function ReconciliationListPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams?: Promise<{ tenantId?: string; businessDayId?: string; shiftId?: string }>;
}) {
  const { stationId } = await params;
  const search = (await searchParams) ?? {};

  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'Authorised organisation',
        station: 'Station context',
        businessDate: 'Business date',
        shift: 'Active shift',
      }}
      role="Station operations"
      userName="Current user"
      breadcrumbs={[
        { label: 'Operations', href: '/operations/daily' },
        { label: 'Reconciliations' },
      ]}
    >
      {search.tenantId ? (
        <OperationsControlRoom
          context={{ tenantId: search.tenantId, stationId, businessDayId: search.businessDayId }}
        />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
