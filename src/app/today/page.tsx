import { AppShell } from '@/design-system/app-shell';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
import {
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';
import { AttendantHome } from '@/modules/forecourt/ui/attendant-home';

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; stationId?: string }>;
}) {
  const search = await searchParams;
  const request = await requestFromServerComponents('/today');
  const workspace = await resolveWebWorkspace({
    request,
    requestedTenantId: search.tenantId,
    requestedStationId: search.stationId,
    requireStation: true,
  });
  const role = workspaceRoleLabel(workspace.role);

  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Choose an organisation',
        station: workspace.station?.stationName ?? 'Choose a station',
        businessDate: 'Today',
      }}
      role={role}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[{ label: 'Today' }]}
    >
      {workspace.needsTenantSelection || workspace.needsStationSelection ? (
        <WorkspaceContextPicker tenants={workspace.tenants} nextPath="/today" />
      ) : workspace.tenant && workspace.station ? (
        <AttendantHome
          tenantId={workspace.tenant.tenantId}
          stationId={workspace.station.stationId}
        />
      ) : null}
    </AppShell>
  );
}
