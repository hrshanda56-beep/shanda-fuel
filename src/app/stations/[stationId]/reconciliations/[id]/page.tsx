import { AppShell } from '@/design-system/app-shell';
import { notFound } from 'next/navigation';
import {
  assertWorkspacePermission,
  requestFromServerComponents,
  resolveWebWorkspace,
  workspaceRoleLabel,
} from '@/modules/authorization/server';
import { WorkspaceContextPicker } from '@/modules/workspaces/ui/context-picker';
import { DailyOperationsContextRequired } from '@/modules/forecourt/ui/daily-operations-workspace';
import { stationReconciliationsPath } from '@/modules/workspaces/navigation';
import {
  ProductionReconciliationWorkflow,
  type ProductionReconciliationContext,
} from '@/modules/forecourt/ui/production-reconciliation-workflow';

export default async function ReconciliationPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string; id: string }>;
  searchParams?: Promise<{
    tenantId?: string;
    businessDayId?: string;
    shiftId?: string;
  }>;
}) {
  const { stationId, id } = await params;
  const search = (await searchParams) ?? {};
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents(`/stations/${stationId}/reconciliations/${id}`),
    requestedTenantId: search.tenantId,
    requestedStationId: stationId,
    requireStation: true,
  });
  try {
    assertWorkspacePermission(workspace, 'reconciliation.view');
  } catch {
    notFound();
  }
  const productionContext: ProductionReconciliationContext | undefined =
    search.tenantId && search.businessDayId && search.shiftId
      ? {
          tenantId: search.tenantId,
          stationId,
          businessDayId: search.businessDayId,
          shiftId: search.shiftId,
          reconciliationId: id,
        }
      : undefined;
  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: workspace.tenant?.tenantName ?? 'Authorised organisation',
        station: workspace.station?.stationName ?? 'Station context',
        businessDate: 'Business date',
        shift: 'Active shift',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[
        {
          label: 'Reconciliations',
          href: stationReconciliationsPath(stationId, workspace.tenant?.tenantId),
        },
        { label: 'Morning shift' },
      ]}
    >
      {workspace.needsTenantSelection || workspace.needsStationSelection ? (
        <WorkspaceContextPicker
          tenants={workspace.tenants}
          nextPath={`/stations/${stationId}/reconciliations/${id}`}
        />
      ) : productionContext ? (
        <ProductionReconciliationWorkflow context={productionContext} role="SUPERVISOR" />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
