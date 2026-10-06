import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { ContextRequiredState } from '@/design-system/primitives';
import { ManagementReportDashboard } from '@/modules/reporting/ui/management-report-dashboard';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; stationId?: string }>;
}) {
  const { tenantId, stationId } = await searchParams;
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'ShandaHR',
        station: 'All authorized stations',
        businessDate: 'Selected range',
      }}
      role="Finance"
      userName="Current user"
      breadcrumbs={[{ label: 'Management reporting' }]}
    >
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
        <ManagementReportDashboard
          key={`${tenantId}:${stationId ?? ''}`}
          tenantId={tenantId}
          initialStationId={stationId}
        />
      ) : (
        <ContextRequiredState
          title="Tenant context required"
          message="Open reporting from an authenticated tenant context before loading management facts."
        />
      )}
    </AppShell>
  );
}
