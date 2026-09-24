import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { SettlementWorkspace } from '@/modules/settlements/ui/settlement-workspace';

export default async function SettlementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stationId } = await params;
  const query = await searchParams;
  const tenantId = typeof query.tenantId === 'string' ? query.tenantId : '';
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'ShandaHR',
        station: stationId,
        businessDate: 'Current',
        shift: 'Finance',
      }}
      role="Finance"
      userName="Current user"
      breadcrumbs={[{ label: 'Provider settlements' }]}
    >
      {tenantId ? (
        <SettlementWorkspace tenantId={tenantId} stationId={stationId} />
      ) : (
        <div className="content-grid">
          <section className="panel" aria-labelledby="settlement-context-title">
            <p className="eyebrow">Electronic payment control</p>
            <h1 id="settlement-context-title">Select a tenant context</h1>
            <p>
              A trusted tenant and station context is required before settlement data can be loaded.
            </p>
          </section>
        </div>
      )}
    </AppShell>
  );
}
