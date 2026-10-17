import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '@/design-system/app-shell';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
import {
  assertWorkspacePermission,
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';
import { CustomerWorkspace } from '@/modules/customers/ui/customer-workspace';

export const metadata: Metadata = { title: 'Customers · Shanda Fuel' };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const search = await searchParams;
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents('/customers'),
    requestedTenantId: search.tenantId,
  });
  try {
    assertWorkspacePermission(workspace, 'customer.view');
  } catch {
    notFound();
  }

  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Choose an organisation',
        station: workspace.station?.stationName ?? 'All authorised stations',
        businessDate: 'Current',
        shift: 'Customers',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[{ label: 'Customers' }]}
    >
      {workspace.needsTenantSelection ? (
        <WorkspaceContextPicker tenants={workspace.tenants} nextPath="/customers" />
      ) : workspace.tenant ? (
        <CustomerWorkspace tenantId={workspace.tenant.tenantId} />
      ) : null}
    </AppShell>
  );
}
