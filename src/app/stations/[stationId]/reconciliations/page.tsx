import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
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
      breadcrumbs={[
        { label: 'Operations', href: '/operations/daily' },
        { label: 'Reconciliations' },
      ]}
    >
      {search.tenantId ? (
        <OperationsControlRoom
          context={{ tenantId: search.tenantId, stationId, businessDayId: search.businessDayId }}
          focus="reconciliations"
        />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
