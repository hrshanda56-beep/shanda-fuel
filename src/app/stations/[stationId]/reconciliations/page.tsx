import { resolvePageContext } from '@/app/_context/page-context';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { DailyOperationsContextRequired } from '@/modules/forecourt/ui/daily-operations-workspace';
import { OperationsControlRoom } from '@/modules/forecourt/ui/operations-control-room';

export const metadata = { title: 'Reconciliations' };

export default async function ReconciliationListPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stationId } = await params;
  const search = (await searchParams) ?? {};
  const context = await resolvePageContext(`/stations/${stationId}/reconciliations`, search);
  const businessDayId = typeof search.businessDayId === 'string' ? search.businessDayId : undefined;

  return (
    <AppShell>
      {context ? (
        <OperationsControlRoom
          context={{ tenantId: context.tenantId, stationId, businessDayId }}
          focus="reconciliations"
        />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
