import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { SupplierWorkspace } from '@/modules/creditors/ui/supplier-workspace';

export const metadata = { title: 'Suppliers' };

export default function SuppliersPage() {
  return (
    <AppShell navigationProjection={syntheticNavigationProjection}>
      <SupplierWorkspace />
    </AppShell>
  );
}
