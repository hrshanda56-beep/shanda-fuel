import 'server-only';

import { sql } from 'drizzle-orm';
import type { CurrentContext } from '../context/contracts';
import { getCashStationSummaryFromRequest } from '../cash/queries';
import { withInventoryReadContext } from '../inventory/application';
import { getSupplierSummaryFromRequest } from '../creditors/queries';
import { getCustomerAccountsFromRequest } from '../customers/queries';
import {
  getProviderSettlementSummaryFromRequest,
  getUnmatchedProviderPaymentsFromRequest,
} from '../settlements/queries';
import { ExactDecimal } from '../../platform/domain/primitives';
import { AppError } from '../../platform/errors';
import { observeError } from '../../platform/observability';
import { isPermissionGranted } from '../../platform/security/permissions';
import { hasAlternateApprover } from '../../platform/security/separation-of-duties';
import { classifyCreditUse, type ActionCenterFacts, type Section } from './action-center-model';

/** A check the person is not allowed to make is "restricted"; anything else is "unavailable". */
async function section<T>(
  request: Request,
  name: string,
  load: () => Promise<T>,
): Promise<Section<T>> {
  try {
    return { status: 'ok', value: await load() };
  } catch (error) {
    if (error instanceof AppError && error.code === 'FORBIDDEN') return { status: 'restricted' };
    observeError(request, error, `finance.action-center.${name}`);
    return { status: 'unavailable' };
  }
}

/**
 * Collect what needs a finance person's attention at the selected station. Read-only. Every part
 * goes through the same per-module authorisation as that module's own screen, and a failure in
 * one part never hides the others.
 */
export async function loadActionCenterFacts(
  request: Request,
  current: CurrentContext & { stationId: string },
): Promise<ActionCenterFacts> {
  const { organisationId: tenantId, stationId } = current;

  const sign = await section(request, 'sign-off', () =>
    withInventoryReadContext(request, tenantId, stationId, async (transaction, context) => {
      const actor = context.authority.authorization;
      const me = actor.membershipId;
      // Listing work is read-only, so ask only whether the role holds the permission. Approving
      // still needs a fresh step-up at the command, and hiding the list until then would show
      // "nothing waiting" while work is waiting.
      const can = (permissionCode: 'reconciliation.approve' | 'approval.act') =>
        isPermissionGranted({ actor, permissionCode, requestedScope: context.scope });

      const reconciliations = can('reconciliation.approve')
        ? {
            rows: (
              await transaction.execute<{
                id: string;
                business_day_id: string;
                shift_id: string | null;
                business_date: string;
                submitted_by: string | null;
              }>(sql`
                select r.id, r.business_day_id, r.shift_id, bd.business_date::text as business_date,
                  r.submitted_by
                from app.reconciliations r
                join app.station_business_days bd
                  on bd.tenant_id = r.tenant_id and bd.station_id = r.station_id and bd.id = r.business_day_id
                where r.tenant_id = ${context.tenantId} and r.station_id = ${context.stationId}
                  and r.state = 'SUBMITTED'
                order by bd.business_date, r.id
              `)
            ).map((row) => ({
              id: row.id,
              businessDayId: row.business_day_id,
              shiftId: row.shift_id,
              businessDate: row.business_date,
              submittedByMe: row.submitted_by === me,
            })),
            soleApprover: !(await hasAlternateApprover(transaction, {
              tenantId: context.tenantId,
              stationId: context.stationId,
              excludeMembershipId: me,
              permission: 'reconciliation.approve',
            })),
          }
        : null;

      const revaluations = can('approval.act')
        ? {
            rows: (
              await transaction.execute<{ id: string; requested_by: string | null }>(sql`
                select id, requested_by
                from app.inventory_cost_revaluations
                where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
                  and status = 'REQUESTED'
                order by requested_at, id
              `)
            ).map((row) => ({ id: row.id, requestedByMe: row.requested_by === me })),
            soleApprover: !(await hasAlternateApprover(transaction, {
              tenantId: context.tenantId,
              stationId: context.stationId,
              excludeMembershipId: me,
              permission: 'approval.act',
            })),
          }
        : null;
      return { reconciliations, revaluations };
    }),
  );

  const fromSign = <K extends 'reconciliations' | 'revaluations'>(
    key: K,
  ): Section<NonNullable<NonNullable<Extract<typeof sign, { status: 'ok' }>['value']>[K]>> => {
    if (sign.status !== 'ok') return sign;
    const value = sign.value[key];
    return value ? { status: 'ok', value: value as never } : { status: 'restricted' };
  };

  const [cash, settlements, suppliers, customers] = await Promise.all([
    section(request, 'cash', async () => {
      const summary = await getCashStationSummaryFromRequest(request, { selection: current });
      return {
        collectedButUnbanked: summary.totals.collectedButUnbanked,
        pendingBankConfirmation: summary.totals.pendingBankConfirmation,
      };
    }),
    section(request, 'settlements', async () => {
      const input = { tenantId, stationId };
      const [rows, unmatched] = await Promise.all([
        getProviderSettlementSummaryFromRequest(request, input),
        getUnmatchedProviderPaymentsFromRequest(request, input),
      ]);
      return {
        toMatch: rows.filter((row) => row.state === 'RECORDED' || row.state === 'PARTIALLY_MATCHED')
          .length,
        exceptions: rows.filter((row) => row.state === 'EXCEPTION').length,
        unmatchedPayments: unmatched.filter((row) => !/^0+(?:\.0+)?$/.test(row.unallocatedAmount))
          .length,
      };
    }),
    section(request, 'suppliers', async () => {
      if (!current.legalEntityId) throw new AppError('FORBIDDEN', 'A legal entity is required');
      const rows = await getSupplierSummaryFromRequest(request, {
        tenantId,
        legalEntityId: current.legalEntityId,
      });
      const overdue = rows.filter((row) => !new ExactDecimal(row.overdue).value.isZero());
      return {
        overdueSuppliers: overdue.length,
        overdueTotal: overdue
          .reduce((sum, row) => sum.add(new ExactDecimal(row.overdue)), new ExactDecimal('0'))
          .toString(),
      };
    }),
    section(request, 'customers', async () => {
      if (!current.legalEntityId) throw new AppError('FORBIDDEN', 'A legal entity is required');
      const { customers: all } = await getCustomerAccountsFromRequest(request, { tenantId });
      // Only credit accounts that this station can serve, in this legal entity.
      const uses = all
        .flatMap((customer) => customer.accounts)
        .filter(
          (account) =>
            account.accountType === 'CREDIT' &&
            account.status === 'ACTIVE' &&
            account.legalEntityId === current.legalEntityId &&
            (account.stationScope === 'ALL' || account.allowedStationIds.includes(stationId)),
        )
        .map((account) => classifyCreditUse(account.balance, account.creditLimit));
      return {
        nearLimit: uses.filter((use) => use === 'near').length,
        overLimit: uses.filter((use) => use === 'over').length,
      };
    }),
  ]);

  return {
    tenantId,
    stationId,
    reconciliations: fromSign('reconciliations'),
    revaluations: fromSign('revaluations'),
    cash,
    settlements,
    suppliers,
    customers,
  };
}
