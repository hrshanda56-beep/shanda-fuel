import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { SupplierWorkspace } from '@/modules/creditors/ui/supplier-workspace';

export default function SuppliersPage() {
  return (
    <AppShell
      navigationProjection={syntheticNavigationProjection}
      context={{
        organisation: 'ShandaHR',
        station: 'Legal-entity scope',
        businessDate: 'Current',
        shift: 'Finance',
      }}
      role="Finance"
      userName="Current user"
      breadcrumbs={[{ label: 'Suppliers' }]}
    >
      <SupplierWorkspace />
    </AppShell>
  );
}
