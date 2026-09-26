import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { ValuationStreamDetail } from '@/modules/costing/ui/valuation-workspace';

export default async function InventoryValuationStreamPage({
  params,
  searchParams,
}: {
  params: Promise<{ tankId: string; productId: string }>;
  searchParams: Promise<{ tenantId?: string; stationId?: string }>;
}) {
  const [route, search] = await Promise.all([params, searchParams]);
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
      breadcrumbs={[
        {
          label: 'Inventory',
          href: context
            ? `/inventory/valuation?${new URLSearchParams(context)}`
            : '/inventory/valuation',
        },
        { label: 'Valuation stream' },
      ]}
    >
      {context ? (
        <ValuationStreamDetail
          context={context}
          tankId={route.tankId}
          productId={route.productId}
        />
      ) : (
        <div className="valuation-workspace">
          <h1>Valuation stream</h1>
          <p className="context-required">
            Select an authorised tenant and station context to review inventory valuation.
          </p>
        </div>
      )}
    </AppShell>
  );
}
