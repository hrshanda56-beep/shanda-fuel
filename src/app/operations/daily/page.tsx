import { AppShell } from '@/design-system/app-shell';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
import {
  assertWorkspacePermission,
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';
import {
  DailyOperationsContextRequired,
  DailyOperationsWorkspace,
  type DailyOperationsContext,
} from '@/modules/forecourt/ui/daily-operations-workspace';
import { OperationsControlRoom } from '@/modules/forecourt/ui/operations-control-room';

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
  const request = await requestFromServerComponents('/operations/daily');
  const workspace = await resolveWebWorkspace({
    request,
    requestedTenantId: search.tenantId,
    requestedStationId: search.stationId,
    requireStation: true,
  });
  try {
    assertWorkspacePermission(workspace, 'business_day.view');
    assertWorkspacePermission(workspace, 'shift.view');
  } catch {
    const { notFound } = await import('next/navigation');
    notFound();
  }
  const tenantId = workspace.tenant?.tenantId ?? search.tenantId;
  const stationId = workspace.station?.stationId ?? search.stationId;
  const hasContext = Boolean(tenantId && stationId && search.businessDayId && search.shiftId);
  const context: DailyOperationsContext | undefined = hasContext
    ? {
        tenantId: tenantId!,
        stationId: stationId!,
        businessDayId: search.businessDayId!,
        shiftId: search.shiftId!,
        reconciliationId: search.reconciliationId,
      }
    : undefined;
  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Choose an organisation',
        station: workspace.station?.stationName ?? 'Choose a station',
        businessDate: 'Business date',
        shift: 'Active shift',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[{ label: 'Operations' }, { label: 'Daily workspace' }]}
    >
      {workspace.needsTenantSelection || workspace.needsStationSelection ? (
        <WorkspaceContextPicker tenants={workspace.tenants} nextPath="/operations/daily" />
      ) : context ? (
        <DailyOperationsWorkspace context={context} />
      ) : tenantId && stationId ? (
        <OperationsControlRoom
          context={{
            tenantId,
            stationId,
            businessDayId: search.businessDayId,
          }}
        />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
