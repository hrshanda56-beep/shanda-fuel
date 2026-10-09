import { AppShell } from '@/design-system/app-shell';
import { Card, ErrorState } from '@/design-system/primitives';
import { ManagementReportDashboard } from '@/modules/reporting/ui/management-report-dashboard';
import { notFound } from 'next/navigation';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
import {
  assertWorkspacePermission,
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const { tenantId: requestedTenantId } = await searchParams;
  const request = await requestFromServerComponents('/reports');
  const workspace = await resolveWebWorkspace({ request, requestedTenantId });
  try {
    assertWorkspacePermission(workspace, 'report.view');
  } catch {
    notFound();
  }
  const tenantId = workspace.tenant?.tenantId;
  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Choose an organisation',
        station: workspace.station?.stationName ?? 'All authorised stations',
        businessDate: 'Selected range',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[{ label: 'Management reporting' }]}
    >
      {workspace.needsTenantSelection ? (
        <WorkspaceContextPicker tenants={workspace.tenants} nextPath="/reports" />
      ) : tenantId ? (
        <ManagementReportDashboard tenantId={tenantId} />
      ) : (
        <Card as="section" className="panel">
          <ErrorState
            title="Tenant context required"
            message="Open reporting from an authenticated tenant context before loading management facts."
          />
        </Card>
      )}
    </AppShell>
  );
}
