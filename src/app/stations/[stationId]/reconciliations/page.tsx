import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { DailyOperationsContextRequired } from '@/modules/forecourt/ui/daily-operations-workspace';
import { ReconciliationsList } from '@/modules/forecourt/ui/reconciliations-list';

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
    <AppShell>
      {search.tenantId ? (
        <ReconciliationsList
          context={{ tenantId: search.tenantId, stationId, businessDayId: search.businessDayId }}
        />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
