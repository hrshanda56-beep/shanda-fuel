import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { SupplierWorkspace } from '@/modules/creditors/ui/supplier-workspace';

export const metadata = { title: 'Suppliers' };

export default function SuppliersPage() {
  return (
    <AppShell>
      <SupplierWorkspace />
    </AppShell>
  );
}
