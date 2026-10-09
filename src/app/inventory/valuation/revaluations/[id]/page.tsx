import { AppShell } from '@/design-system/app-shell';
import { notFound } from 'next/navigation';
import {
  assertWorkspacePermission,
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
import { RevaluationDetail } from '@/modules/costing/ui/valuation-workspace';

export default async function InventoryRevaluationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tenantId?: string; stationId?: string }>;
}) {
  const [route, search] = await Promise.all([params, searchParams]);
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents(`/inventory/valuation/revaluations/${route.id}`),
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
        organisation: workspace.tenant?.tenantName ?? 'Authorised organisation',
        station: workspace.station?.stationName ?? 'Selected station',
        businessDate: 'Business date',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[
        {
          label: 'Inventory',
          href: context ? contextHref : '/inventory/valuation',
        },
        { label: 'Revaluation history' },
      ]}
    >
      {workspace.needsTenantSelection || workspace.needsStationSelection ? (
        <WorkspaceContextPicker
          tenants={workspace.tenants}
          nextPath={`/inventory/valuation/revaluations/${route.id}`}
        />
      ) : context ? (
        <RevaluationDetail context={context} contextHref={contextHref} revaluationId={route.id} />
      ) : (
        <div className="valuation-workspace">
          <h1>Revaluation history</h1>
          <p className="context-required">
            Select an authorised tenant and station context to review revaluation history.
          </p>
        </div>
      )}
    </AppShell>
  );
}
