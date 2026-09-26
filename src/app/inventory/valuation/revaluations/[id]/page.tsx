import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { RevaluationDetail } from '@/modules/costing/ui/valuation-workspace';

export default async function InventoryRevaluationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
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
        { label: 'Revaluation history' },
      ]}
    >
      {context ? (
        <RevaluationDetail context={context} revaluationId={route.id} />
      ) : (
        <div className="valuation-workspace">
          <h1>Revaluation history</h1>
          <p className="context-required">
            Select an authorised tenant and station context to review revaluation history.
          </p>
        </div>
      )}
    </AppShell>
  );
}
