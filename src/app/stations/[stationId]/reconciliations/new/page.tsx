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
import {
  ProductionReconciliationWorkflow,
  type ProductionReconciliationContext,
} from '@/modules/forecourt/ui/production-reconciliation-workflow';

export default async function NewReconciliationPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams?: Promise<{
    tenantId?: string;
    businessDayId?: string;
    shiftId?: string;
    reconciliationId?: string;
  }>;
}) {
  const { stationId } = await params;
  const search = (await searchParams) ?? {};
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents(`/stations/${stationId}/reconciliations/new`),
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
    search.tenantId && search.businessDayId && search.shiftId && search.reconciliationId
      ? {
          tenantId: search.tenantId,
          stationId,
          businessDayId: search.businessDayId,
          shiftId: search.shiftId,
          reconciliationId: search.reconciliationId,
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
        { label: 'Reconciliations', href: '/stations/demo/reconciliations' },
        { label: 'New' },
      ]}
    >
      {workspace.needsTenantSelection || workspace.needsStationSelection ? (
        <WorkspaceContextPicker
          tenants={workspace.tenants}
          nextPath={`/stations/${stationId}/reconciliations/new`}
        />
      ) : productionContext ? (
        <ProductionReconciliationWorkflow context={productionContext} role="SUPERVISOR" />
      ) : (
        <DailyOperationsContextRequired />
      )}
    </AppShell>
  );
}
