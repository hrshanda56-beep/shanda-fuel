import { AppShell } from '@/design-system/app-shell';
import { syntheticNavigationProjection } from '@/design-system/navigation';
import { CustomerWorkspace } from '@/modules/customers/ui/customer-workspace';

export const metadata = { title: 'Customers' };

export default function CustomersPage() {
  return (
    <AppShell navigationProjection={syntheticNavigationProjection}>
      <CustomerWorkspace />
    </AppShell>
  );
}
