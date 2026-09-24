import { AppShell } from '@/design-system/app-shell';
import { Card, ErrorState } from '@/design-system/primitives';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { CashWorkspace } from '@/modules/cash/ui/cash-workspace';

export default async function CashPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const [{ stationId }, { tenantId }] = await Promise.all([params, searchParams]);
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'TEI Oils',
        station: stationId,
        businessDate: 'Active business date',
      }}
      role="Finance"
      userName="Finance operator"
      breadcrumbs={[{ label: 'Cash and banking' }]}
    >
      <div className="page-header">
        <div>
          <p className="eyebrow">Cash and banking</p>
          <h1>Station collections</h1>
          <p className="lede">
            Track custody, collection allocation, and distinct bank confirmation.
          </p>
        </div>
      </div>
      {tenantId ? (
        <CashWorkspace tenantId={tenantId} stationId={stationId} />
      ) : (
        <Card as="section" className="panel">
          <ErrorState
            title="Tenant context required"
            message="Open this station from an authenticated tenant context before loading cash data."
          />
        </Card>
      )}
    </AppShell>
  );
}
