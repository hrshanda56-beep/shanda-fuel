import { AppShell } from '@/design-system/app-shell';
import { PageHeader } from '@/design-system/layout';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { ContextRequiredState } from '@/design-system/primitives';
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
        <>
          <PageHeader
            eyebrow="Supplier creditors"
            title="Payables position"
            description="What each legal entity owes its suppliers, current and overdue."
          />
          <ContextRequiredState
            title="Select a legal entity"
            message="A trusted tenant and legal-entity context is required before creditor balances can be loaded."
          />
        </>
      )}
    </AppShell>
  );
}
