import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import {
  DailyOperationsContextRequired,
  DailyOperationsWorkspace,
  type DailyOperationsContext,
} from '@/modules/forecourt/ui/daily-operations-workspace';

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

  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'Authorised organisation',
        station: 'Select station context',
        businessDate: 'Business date',
        shift: 'Active shift',
      }}
      role="Station operations"
      userName="Current user"
      breadcrumbs={[{ label: 'Operations' }, { label: 'Daily workspace' }]}
    >
      {context ? (
        <DailyOperationsWorkspace context={context} />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
