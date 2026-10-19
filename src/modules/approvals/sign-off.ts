import 'server-only';
import { sql } from 'drizzle-orm';
import type { InventoryTransaction, InventoryCommandContext } from '../inventory/application';
import { isPermissionGranted } from '../../platform/security/permissions';
import { alternateApproverQuery } from '../../platform/security/separation-of-duties';
import { AppError } from '../../platform/errors';
export async function loadSignOffFacts(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
) {
  const me = context.authority.authorization.membershipId;
  const canReconcile = isPermissionGranted({
    actor: context.authority.authorization,
    permissionCode: 'reconciliation.approve',
    requestedScope: context.scope,
  });
  const canRevalue = isPermissionGranted({
    actor: context.authority.authorization,
    permissionCode: 'approval.act',
    requestedScope: context.scope,
  });
  if (!canReconcile && !canRevalue) return { reconciliations: null, revaluations: null };
  const empty = sql`select null as unavailable where false`;
  const reconciliations = canReconcile
    ? sql`
  select r.id,r.business_day_id,r.shift_id,bd.business_date::text as business_date,r.submitted_by
  from app.reconciliations r join app.station_business_days bd
   on bd.tenant_id=r.tenant_id and bd.station_id=r.station_id and bd.id=r.business_day_id
  where r.tenant_id=${context.tenantId} and r.station_id=${context.stationId} and r.state='SUBMITTED'
  order by bd.business_date,r.id`
    : empty;
  const revaluations = canRevalue
    ? sql`
  select id,requested_by from app.inventory_cost_revaluations
  where tenant_id=${context.tenantId} and station_id=${context.stationId} and status='REQUESTED'
  order by requested_at,id`
    : empty;
  const alternate = (permission: string) =>
    alternateApproverQuery({
      tenantId: context.tenantId,
      stationId: context.stationId,
      excludeMembershipId: me,
      permission,
    });
  const rows = await transaction.execute<{
    reconciliations: {
      id: string;
      business_day_id: string;
      shift_id: string | null;
      business_date: string;
      submitted_by: string | null;
    }[];
    revaluations: { id: string; requested_by: string | null }[];
    other_reconciler: boolean;
    other_revaluer: boolean;
  }>(sql`
 with reconciliations as (${reconciliations}),revaluations as (${revaluations})
 select coalesce((select json_agg(reconciliations) from reconciliations),'[]'::json) as reconciliations,
 coalesce((select json_agg(revaluations) from revaluations),'[]'::json) as revaluations,
 exists(${canReconcile ? alternate('reconciliation.approve') : empty}) as other_reconciler,
 exists(${canRevalue ? alternate('approval.act') : empty}) as other_revaluer
 `);
  const row = rows[0];
  if (!row) throw new AppError('INVARIANT_VIOLATION', 'Finance sign-off facts were not returned');
  return {
    reconciliations: canReconcile
      ? {
          rows: row.reconciliations.map((r) => ({
            id: r.id,
            businessDayId: r.business_day_id,
            shiftId: r.shift_id,
            businessDate: r.business_date,
            submittedByMe: r.submitted_by === me,
          })),
          soleApprover: !row.other_reconciler,
        }
      : null,
    revaluations: canRevalue
      ? {
          rows: row.revaluations.map((r) => ({ id: r.id, requestedByMe: r.requested_by === me })),
          soleApprover: !row.other_revaluer,
        }
      : null,
  };
}
