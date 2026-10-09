import { redirect } from 'next/navigation';
import { AppShell } from '@/design-system/app-shell';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
import {
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';

import { TodayOverview } from './_overview/today-overview';

export const metadata = {
  title: { absolute: 'Dashboard · Shanda Fuel' },
};

/** Today for the selected station: daily operations and anything needing attention. */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; stationId?: string }>;
}) {
  const search = await searchParams;
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents('/'),
    requestedTenantId: search.tenantId,
    requestedStationId: search.stationId,
  });

  if (workspace.needsTenantSelection || workspace.needsStationSelection) {
    return <WorkspaceContextPage workspace={workspace} nextPath="/" />;
  }
  if (workspace.landingPath !== '/') redirect(workspace.landingPath);

  return (
    <AppShell
      searchPlacement="header"
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Authorised organisations',
        station: workspace.station?.stationName ?? 'All authorised stations',
        businessDate: 'Today',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[{ label: 'Overview' }]}
    >
      <TodayOverview
        tenantId={workspace.tenant?.tenantId ?? search.tenantId}
        stationId={workspace.station?.stationId ?? search.stationId}
      />
    </AppShell>
  );
}

function WorkspaceContextPage({
  workspace,
  nextPath,
}: {
  workspace: Awaited<ReturnType<typeof resolveWebWorkspace>>;
  nextPath: string;
}) {
  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Choose an organisation',
        station: 'Choose a station',
        businessDate: 'Today',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[{ label: 'Choose work context' }]}
    >
      <WorkspaceContextPicker tenants={workspace.tenants} nextPath={nextPath} />
    </AppShell>
  );
}
