import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { ValuationOverview } from '@/modules/costing/ui/valuation-workspace';

export default async function InventoryValuationPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; stationId?: string }>;
}) {
  const search = await searchParams;
  const context =
    search.tenantId && search.stationId
      ? { tenantId: search.tenantId, stationId: search.stationId }
      : null;
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'Authorised organisation',
        station: 'Selected station',
        businessDate: 'Business date',
      }}
      role="Inventory control"
      userName="Current user"
      breadcrumbs={[{ label: 'Inventory' }, { label: 'Valuation' }]}
    >
      {context ? (
        <ValuationOverview context={context} />
      ) : (
        <div className="valuation-workspace">
          <div className="page-heading">
            <div>
              <span className="eyebrow">Inventory control</span>
              <h1>Inventory valuation</h1>
              <p>
                Select an authorised tenant and station before reviewing persisted valuation
                evidence.
              </p>
            </div>
          </div>
          <p className="context-required">
            Select an authorised tenant and station context to review inventory valuation.
          </p>
        </div>
      )}
    </AppShell>
  );
}
