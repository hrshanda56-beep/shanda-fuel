import { AppShell } from '@/design-system/app-shell';
import { notFound } from 'next/navigation';
import {
  assertWorkspacePermission,
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
import {
  DailyOperationsContextRequired,
  DailyOperationsWorkspace,
  type DailyOperationsContext,
} from '@/modules/forecourt/ui/daily-operations-workspace';

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
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents(`/operations/reconciliations/${id}`),
    requestedTenantId: search.tenantId,
    requestedStationId: search.stationId,
    requireStation: true,
  });
  try {
    assertWorkspacePermission(workspace, 'reconciliation.view');
  } catch {
    notFound();
  }
  const hasContext = Boolean(
    (workspace.tenant?.tenantId ?? search.tenantId) &&
    (workspace.station?.stationId ?? search.stationId) &&
    search.businessDayId &&
    search.shiftId,
  );
  const context: DailyOperationsContext | undefined = hasContext
    ? {
        tenantId: workspace.tenant?.tenantId ?? search.tenantId!,
        stationId: workspace.station?.stationId ?? search.stationId!,
        businessDayId: search.businessDayId!,
        shiftId: search.shiftId!,
        reconciliationId: id,
      }
    : undefined;

  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Authorised organisation',
        station: workspace.station?.stationName ?? 'Station context',
        businessDate: 'Business date',
        shift: 'Active shift',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[
        { label: 'Operations', href: '/operations/daily' },
        { label: 'Reconciliation' },
      ]}
    >
      {workspace.needsTenantSelection || workspace.needsStationSelection ? (
        <WorkspaceContextPicker
          tenants={workspace.tenants}
          nextPath={`/operations/reconciliations/${id}`}
        />
      ) : context ? (
        <DailyOperationsWorkspace context={context} />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
