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
import { ExpensesWorkspace } from '@/modules/expenses/ui/expenses-workspace';

export const metadata: Metadata = {
  title: 'Expenses · Shanda Fuel',
};

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tenantId?: string;
    stationId?: string;
  }>;
}) {
  const search = await searchParams;
  const workspace = await resolveWebWorkspace({
    request: await requestFromServerComponents('/expenses'),
    requestedTenantId: search.tenantId,
    requestedStationId: search.stationId,
    requireStation: true,
  });

  try {
    assertWorkspacePermission(workspace, 'expense.view');
  } catch {
    notFound();
  }

  const tenant = workspace.tenant;
  const station = workspace.station;
  const hasPermission = (permission: Parameters<typeof assertWorkspacePermission>[1]) => {
    try {
      assertWorkspacePermission(workspace, permission);
      return true;
    } catch {
      return false;
    }
  };
  const canSubmit = hasPermission('expense.submit');
  const canApprove = hasPermission('expense.approve');
  const canPost = hasPermission('expense.post');
  const canReverse = hasPermission('expense.reverse');
  let canManageRecurring = false;
  try {
    assertWorkspacePermission(workspace, 'expense.recurring.manage');
    canManageRecurring = true;
  } catch {
    // The recurring configuration panel is owner-only; the expense workspace remains available.
  }
  const context =
    tenant && station
      ? {
          tenantId: tenant.tenantId,
          legalEntityId: station.legalEntityId,
          stationId: station.stationId,
          organisationName: tenant.tenantName,
          stationName: station.stationName,
          canSubmit,
          canApprove,
          canPost,
          canReverse,
          canManageRecurring,
        }
      : null;

  return (
    <AppShell
      navigationProjection={workspace.navigationProjection}
      context={{
        organisation: tenant?.tenantName ?? 'Choose an organisation',
        station: station?.stationName ?? 'Choose a station',
        businessDate: 'Business date',
        shift: 'Expenses',
      }}
      role={workspaceRoleLabel(workspace.role)}
      userName={workspace.actor.displayName ?? workspace.actor.email ?? 'Current user'}
      breadcrumbs={[{ label: 'Expenses' }]}
    >
      {workspace.needsTenantSelection || workspace.needsStationSelection ? (
        <WorkspaceContextPicker tenants={workspace.tenants} nextPath="/expenses" />
      ) : context ? (
        <ExpensesWorkspace context={context} />
      ) : (
        <div className="content-grid">
          <section className="panel" aria-labelledby="expense-context-title">
            <p className="eyebrow">Expense control</p>
            <h1 id="expense-context-title">Select a station context</h1>
            <p>
              A trusted tenant, legal entity, and station context is required before expenses can be
              loaded or submitted.
            </p>
          </section>
        </div>
      )}
    </AppShell>
  );
}
