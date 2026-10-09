import { AppShell } from '@/design-system/app-shell';
import { notFound } from 'next/navigation';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
import {
  assertWorkspacePermission,
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';
import { ValuationOverview } from '@/modules/costing/ui/valuation-workspace';

export default async function InventoryValuationPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; stationId?: string }>;
}) {
  const search = await searchParams;
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents('/inventory/valuation'),
    requestedTenantId: search.tenantId,
    requestedStationId: search.stationId,
    requireStation: true,
  });
  try {
    assertWorkspacePermission(workspace, 'inventory.view');
  } catch {
    notFound();
  }
  const tenantId = workspace.tenant?.tenantId ?? search.tenantId;
  const stationId = workspace.station?.stationId ?? search.stationId;
  const context =
    tenantId && workspace.station
      ? {
          tenantId,
          legalEntityId: workspace.station.legalEntityId,
          stationId: workspace.station.stationId,
          organisationName: workspace.station.tenantName,
          legalEntityName: workspace.station.legalEntityName,
          stationName: workspace.station.stationName,
          stationTimezone: workspace.station.timezone,
        }
      : null;
  const contextHref = context
    ? `/inventory/valuation?${new URLSearchParams({ tenantId: context.tenantId, stationId: context.stationId })}`
    : '/inventory/valuation';
  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Choose an organisation',
        station: workspace.station?.stationName ?? 'Choose a station',
        businessDate: 'Business date',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[{ label: 'Inventory' }, { label: 'Valuation' }]}
    >
      {workspace.needsTenantSelection || workspace.needsStationSelection ? (
        <WorkspaceContextPicker tenants={workspace.tenants} nextPath="/inventory/valuation" />
      ) : context ? (
        <ValuationOverview context={context} contextHref={contextHref} />
      ) : (
        <div className="valuation-workspace">
          <div className="page-heading">
            <div>
              <span className="eyebrow">Inventory control · A12</span>
              <h1>Inventory valuation</h1>
              <p>
                Select an authorised tenant and station before reviewing persisted valuation
                evidence.
              </p>
            </div>
          </div>
          <p className="context-required">
            Select an authorised tenant and station context to review inventory valuation.
          </p>
        </div>
      )}
    </AppShell>
  );
}
