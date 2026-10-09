import { AppShell } from '@/design-system/app-shell';
import { notFound } from 'next/navigation';
import {
  assertWorkspacePermission,
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
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
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents(`/stations/${stationId}/reconciliations`),
    requestedTenantId: search.tenantId,
    requestedStationId: stationId,
    requireStation: true,
  });
  try {
    assertWorkspacePermission(workspace, 'reconciliation.view');
  } catch {
    notFound();
  }

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
        { label: 'Reconciliations' },
      ]}
    >
      {workspace.needsTenantSelection || workspace.needsStationSelection ? (
        <WorkspaceContextPicker
          tenants={workspace.tenants}
          nextPath={`/stations/${stationId}/reconciliations`}
        />
      ) : search.tenantId || workspace.tenant ? (
        <OperationsControlRoom
          context={{
            tenantId: workspace.tenant?.tenantId ?? search.tenantId!,
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
