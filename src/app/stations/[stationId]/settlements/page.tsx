import { AppShell } from '@/design-system/app-shell';
import { notFound } from 'next/navigation';
import {
  assertWorkspacePermission,
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';
import { SettlementWorkspace } from '@/modules/settlements/ui/settlement-workspace';

export default async function SettlementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stationId } = await params;
  const query = await searchParams;
  const requestedTenantId = typeof query.tenantId === 'string' ? query.tenantId : undefined;
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents(`/stations/${stationId}/settlements`),
    requestedTenantId,
    requestedStationId: stationId,
    requireStation: true,
  });
  try {
    assertWorkspacePermission(workspace, 'provider.settlement.view');
  } catch {
    notFound();
  }
  const tenantId = workspace.tenant?.tenantId ?? '';
  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Authorised organisation',
        station: workspace.station?.stationName ?? stationId,
        businessDate: 'Current',
        shift: 'Finance',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[{ label: 'Provider settlements' }]}
    >
      {tenantId ? (
        <SettlementWorkspace stationId={stationId} />
      ) : (
        <div className="content-grid">
          <section className="panel" aria-labelledby="settlement-context-title">
            <p className="eyebrow">Electronic payment control</p>
            <h1 id="settlement-context-title">Select a tenant context</h1>
            <p>
              A trusted tenant and station context is required before settlement data can be loaded.
            </p>
          </section>
        </div>
      )}
    </AppShell>
  );
}
