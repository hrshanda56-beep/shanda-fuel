import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { ContextRequiredState } from '@/design-system/primitives';
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
    <AppShell navigationProjection={syntheticNavigationProjection}>
      <div className="page-header">
        <div>
          <p className="eyebrow">Management reporting</p>
          <h1>Operational financial position</h1>
          <p className="lede">
            A factual view across approved sales, custody, settlements, commercial exposure, and
            stock.
          </p>
        </div>
      </div>
      {tenantId ? (
        <ManagementReportDashboard tenantId={tenantId} />
      ) : (
        <ContextRequiredState
          title="Choose an organisation to view reports"
          message="Use Change above to choose an authorised organisation before loading reporting data."
        />
      )}
    </AppShell>
  );
}
