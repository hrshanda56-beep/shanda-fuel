import { Suspense } from 'react';
import { AppShell } from '@/design-system/app-shell';
import { ContextRequiredState } from '@/design-system/primitives';
import { ReportsFilters } from '@/modules/reporting/ui/reports-filters';
import { ReportsRail } from '@/modules/reporting/ui/reports-rail';
import { ReportList } from '@/modules/reporting/ui/report-list';
import { ManagementReportDashboard } from '@/modules/reporting/ui/management-report-dashboard';
import { notFound } from 'next/navigation';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
import {
  assertWorkspacePermission,
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';

export const metadata = {
  title: 'Reports',
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const { tenantId: requestedTenantId } = await searchParams;
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents('/reports'),
    requestedTenantId,
  });
  try {
    assertWorkspacePermission(workspace, 'report.view');
  } catch {
    notFound();
  }
  const tenantId = workspace.tenant?.tenantId ?? requestedTenantId;
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
      pageSubtitle="Operational financial position"
    >
      <p className="lede">
        A factual view across approved sales, custody, settlements, commercial exposure, and stock.
      </p>
      {workspace.needsTenantSelection ? (
        <WorkspaceContextPicker tenants={workspace.tenants} nextPath="/reports" />
      ) : tenantId ? (
        <Suspense>
          <div className="reports-stack">
            <ReportsFilters tenantId={tenantId} />
            <ManagementReportDashboard tenantId={tenantId} view="summary" />
            <div className="reports-layout">
              <ReportList tenantId={tenantId} />
              <ReportsRail tenantId={tenantId} />
            </div>
            <p className="metric-meta">
              Figures come from posted source records, each on its own date basis. This is an
              operational view, not a general ledger, statutory P&amp;L, balance sheet, tax report,
              or bank statement.
            </p>
          </div>
        </Suspense>
      ) : (
        <ContextRequiredState
          title="Choose an organisation to view reports"
          message="Use Change above to choose an authorised organisation before loading reporting data."
        />
      )}
    </AppShell>
  );
}
