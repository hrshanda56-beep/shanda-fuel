import { redirect } from 'next/navigation';
import { AppShell } from '@/design-system/app-shell';
import { Card } from '@/design-system/primitives';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
import {
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; stationId?: string }>;
}) {
  const request = await requestFromServerComponents('/');
  const search = await searchParams;
  const workspace = await resolveWebWorkspace({
    request,
    requestedTenantId: search.tenantId,
    requestedStationId: search.stationId,
  });

  if (workspace.needsTenantSelection) {
    return <WorkspaceContextPage workspace={workspace} nextPath={workspace.landingPath} />;
  }
  if (workspace.landingPath !== '/') redirect(workspace.landingPath);

  const role = workspaceRoleLabel(workspace.role);
  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Authorised organisations',
        station: workspace.station?.stationName ?? 'All authorised stations',
        businessDate: 'Today',
      }}
      role={role}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[{ label: 'Overview' }]}
    >
      <div className="page-header">
        <div>
          <p className="eyebrow">{role} workspace</p>
          <h1>Business overview</h1>
          <p className="lede">The areas available to you are ready when you need them.</p>
        </div>
      </div>
      <section className="metric-grid" aria-label="Workspace summary">
        <Card className="metric-card">
          <span className="metric-label">Stations</span>
          <strong className="metric-value">{workspace.stations.length}</strong>
          <span className="metric-meta">Authorised stations</span>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Work context</span>
          <strong className="metric-value">{workspace.station?.stationCode ?? 'All'}</strong>
          <span className="metric-meta">Selected from your access</span>
        </Card>
        <Card className="metric-card">
          <span className="metric-label">Status</span>
          <strong className="metric-value">Ready</strong>
          <span className="metric-meta">Server-authorised workspace</span>
        </Card>
      </section>
      <Card as="section" className="panel" aria-labelledby="overview-title">
        <p className="eyebrow">Start here</p>
        <h2 id="overview-title">Choose the work you need to do</h2>
        <p>
          Use the navigation for the operational, financial, reporting, and administration areas
          available to your account.
        </p>
      </Card>
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
