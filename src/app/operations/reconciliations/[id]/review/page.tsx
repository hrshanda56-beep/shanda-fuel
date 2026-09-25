import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import {
  DailyOperationsContextRequired,
  DailyOperationsWorkspace,
  type DailyOperationsContext,
} from '@/modules/forecourt/ui/daily-operations-workspace';

export default async function OperationsReconciliationReviewPage({
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
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'Authorised organisation',
        station: 'Station context',
        businessDate: 'Business date',
        shift: 'Active shift',
      }}
      role="Management review"
      userName="Current user"
      breadcrumbs={[
        { label: 'Operations', href: '/operations/daily' },
        { label: 'Management review' },
      ]}
    >
      {context ? (
        <DailyOperationsWorkspace context={context} role="MANAGEMENT" />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
