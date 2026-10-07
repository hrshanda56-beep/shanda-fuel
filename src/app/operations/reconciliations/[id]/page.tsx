import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import {
  DailyOperationsContextRequired,
  DailyOperationsWorkspace,
  type DailyOperationsContext,
} from '@/modules/forecourt/ui/daily-operations-workspace';

export const metadata = { title: 'Reconciliation' };

export default async function OperationsReconciliationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tenantId?: string;
    stationId?: string;
    businessDayId?: string;
    shiftId?: string;
  }>;
}) {
  const { id } = await params;
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
        reconciliationId: id,
      }
    : undefined;

  return (
    <AppShell
      breadcrumbs={[
        { label: 'Operations', href: '/operations/daily' },
        { label: 'Reconciliation' },
      ]}
    >
      {context ? (
        <DailyOperationsWorkspace context={context} />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
