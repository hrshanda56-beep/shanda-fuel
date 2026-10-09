import { AppShell } from '@/design-system/app-shell';
import { Card, ErrorState } from '@/design-system/primitives';
import { notFound } from 'next/navigation';
import {
  assertWorkspacePermission,
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';
import { CashWorkspace } from '@/modules/cash/ui/cash-workspace';

export default async function CashPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const [{ stationId }, { tenantId: requestedTenantId }] = await Promise.all([
    params,
    searchParams,
  ]);
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents(`/stations/${stationId}/cash`),
    requestedTenantId: requestedTenantId ?? undefined,
    requestedStationId: stationId,
    requireStation: true,
  });
  try {
    assertWorkspacePermission(workspace, 'cash.collection.view');
  } catch {
    notFound();
  }
  const tenantId = workspace.tenant?.tenantId ?? requestedTenantId;
  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Authorised organisation',
        station: workspace.station?.stationName ?? stationId,
        businessDate: 'Active business date',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[{ label: 'Cash and banking' }]}
    >
      <div className="page-header">
        <div>
          <p className="eyebrow">Cash and banking</p>
          <h1>Station collections</h1>
          <p className="lede">
            Track custody, collection allocation, and distinct bank confirmation.
          </p>
        </div>
      </div>
      {tenantId && workspace.station ? (
        <CashWorkspace />
      ) : (
        <Card as="section" className="panel">
          <ErrorState
            title="Tenant context required"
            message="Open this station from an authenticated tenant context before loading cash data."
          />
        </Card>
      )}
    </AppShell>
  );
}
