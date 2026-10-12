import { Suspense } from 'react';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { ContextRequiredState } from '@/design-system/primitives';
import { ReportsFilters } from '@/modules/reporting/ui/reports-filters';
import { ReportsRail } from '@/modules/reporting/ui/reports-rail';
import { ReportList } from '@/modules/reporting/ui/report-list';
import { ManagementReportDashboard } from '@/modules/reporting/ui/management-report-dashboard';

export const metadata = {
  title: 'Reports',
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const { tenantId } = await searchParams;
  return (
    <AppShell pageSubtitle="Operational financial position">
      <p className="lede">
        Approved sales, cash, settlements, balances and stock for the chosen period.
      </p>
      {tenantId ? (
        <Suspense>
          <div className="reports-stack">
            <ReportsFilters tenantId={tenantId} />
            <ManagementReportDashboard tenantId={tenantId} view="summary" />
            <div className="reports-layout">
              <ReportList tenantId={tenantId} />
              <ReportsRail tenantId={tenantId} />
            </div>
            <p className="metric-meta">
              Figures come from approved records, each dated by its own business date. This is not a
              general ledger, statutory P&amp;L, balance sheet, tax report or bank statement.
            </p>
          </div>
        </Suspense>
      ) : (
        <ContextRequiredState
          title="Choose an organisation to view reports"
          message="Use the work context selector above to choose an organisation."
        />
      )}
    </AppShell>
  );
}
