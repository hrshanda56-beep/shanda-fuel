import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { DailyOperationsContextRequired } from '@/modules/forecourt/ui/daily-operations-workspace';
import { OperationsControlRoom } from '@/modules/forecourt/ui/operations-control-room';

export const metadata = { title: 'Reconciliations' };

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
