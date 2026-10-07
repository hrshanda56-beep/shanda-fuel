import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { SupplierDetailWorkspace } from '@/modules/creditors/ui/supplier-detail-workspace';

export const metadata = { title: 'Supplier detail' };

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = await params;
  return (
    <AppShell
      breadcrumbs={[{ label: 'Suppliers', href: '/suppliers' }, { label: 'Supplier detail' }]}
    >
      <SupplierDetailWorkspace supplierId={supplierId} />
    </AppShell>
  );
}
