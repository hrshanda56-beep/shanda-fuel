import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { CustomerDetailWorkspace } from '@/modules/customers/ui/customer-detail-workspace';

export const metadata = { title: 'Customer detail' };

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  return (
    <AppShell
      breadcrumbs={[{ label: 'Customers', href: '/customers' }, { label: 'Customer detail' }]}
    >
      <CustomerDetailWorkspace customerId={customerId} />
    </AppShell>
  );
}
