import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { CustomerWorkspace } from '@/modules/customers/ui/customer-workspace';

export const metadata = { title: 'Customers' };

export default function CustomersPage() {
  return (
    <AppShell>
      <CustomerWorkspace />
    </AppShell>
  );
}
