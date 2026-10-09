import { AppShell } from '@/design-system/app-shell';
import { notFound } from 'next/navigation';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
import {
  assertWorkspacePermission,
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';
import { SupplierWorkspace } from '@/modules/creditors/ui/supplier-workspace';

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedTenantId = typeof params.tenantId === 'string' ? params.tenantId : undefined;
  const requestedLegalEntityId =
    typeof params.legalEntityId === 'string' ? params.legalEntityId : undefined;
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents('/suppliers'),
    requestedTenantId,
  });
  try {
    assertWorkspacePermission(workspace, 'supplier.view');
  } catch {
    notFound();
  }
  const tenantId = workspace.tenant?.tenantId ?? '';
  const legalEntityId =
    requestedLegalEntityId ??
    workspace.station?.legalEntityId ??
    workspace.tenant?.stations[0]?.legalEntityId ??
    '';
  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Choose an organisation',
        station: workspace.station?.stationName ?? 'All authorised stations',
        businessDate: 'Current',
        shift: 'Finance',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[{ label: 'Suppliers' }]}
    >
      {workspace.needsTenantSelection ? (
        <WorkspaceContextPicker tenants={workspace.tenants} nextPath="/suppliers" />
      ) : tenantId && legalEntityId ? (
        <SupplierWorkspace tenantId={tenantId} legalEntityId={legalEntityId} />
      ) : (
        <div className="content-grid">
          <section className="panel" aria-labelledby="supplier-context-title">
            <p className="eyebrow">Supplier creditors</p>
            <h1 id="supplier-context-title">Select a legal entity</h1>
            <p>
              A trusted tenant and legal-entity context is required before creditor balances can be
              loaded.
            </p>
          </section>
        </div>
      )}
    </AppShell>
  );
}
