import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { SupplierWorkspace } from '@/modules/creditors/ui/supplier-workspace';

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tenantId = typeof params.tenantId === 'string' ? params.tenantId : '';
  const legalEntityId = typeof params.legalEntityId === 'string' ? params.legalEntityId : '';
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'ShandaHR',
        station: 'All stations',
        businessDate: 'Current',
        shift: 'Finance',
      }}
      role="Finance"
      userName="Current user"
      breadcrumbs={[{ label: 'Suppliers' }]}
    >
      {tenantId && legalEntityId ? (
        <SupplierWorkspace tenantId={tenantId} legalEntityId={legalEntityId} />
      ) : (
        <div className="content-grid">
          <section className="panel" aria-labelledby="supplier-context-title">
            <p className="eyebrow">Supplier creditors</p>
            <h1 id="supplier-context-title">Select a legal entity</h1>
            <p>
              A trusted tenant and legal-entity context is required before creditor balances can be
              loaded.
            </p>
          </section>
        </div>
      )}
    </AppShell>
  );
}
