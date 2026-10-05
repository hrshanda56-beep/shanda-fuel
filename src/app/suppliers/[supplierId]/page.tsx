import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
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
      navigationProjection={syntheticNavigationProjection}
      breadcrumbs={[{ label: 'Suppliers', href: '/suppliers' }, { label: 'Supplier detail' }]}
    >
      <SupplierDetailWorkspace supplierId={supplierId} />
    </AppShell>
  );
}
