import { loadOperationsFacts } from './operations-facts';
import { loadExtraAlertFacts } from './extra-alert-facts';
import { loadSignOffFacts } from './sign-off';
import { withRequestReadScope } from '../../platform/security/request-read-scope';
import { requireAuthenticatedActor, type AuthenticatedActorContext } from '../identity';
import 'server-only';

import type { CurrentContext } from '../context/contracts';
import { getCashStationSummaryFromRequest } from '../cash/queries';
import { withInventoryReadContext } from '../inventory/application';
import { getSupplierSummaryFromRequest } from '../creditors/queries';
import { getSettlementOverviewFromRequest } from '../settlements/queries';
import { ExactDecimal } from '../../platform/domain/primitives';
import { AppError } from '../../platform/errors';
import { observeError } from '../../platform/observability';
import { classifyCreditUse, type ActionCenterFacts, type Section } from './action-center-model';
import { DEFAULT_ALERT_SETTINGS } from './operations-alerts';
import { getCustomerAccountsFromRequest } from '../customers/queries';

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
async function loadActionCenterFactsUncached(
  request: Request,
  current: CurrentContext & { stationId: string },
  authenticatedActor?: AuthenticatedActorContext,
): Promise<ActionCenterFacts> {
  const { organisationId: tenantId, stationId } = current;
  const actor = authenticatedActor ?? (await requireAuthenticatedActor(request));

  const signPromise = section(request, 'sign-off', () =>
    withInventoryReadContext(
      request,
      tenantId,
      stationId,
      (transaction, context) => loadSignOffFacts(transaction, context),
      actor,
    ),
  );

  const operationsPromise = section(request, 'operations', () =>
    withInventoryReadContext(
      request,
      tenantId,
      stationId,
      (transaction, context) => loadOperationsFacts(transaction, context),
      actor,
    ),
  );

  const extraPromise = section(request, 'extra-alerts', async () => {
    const ops = await operationsPromise;
    // Dates are the station's own; without them nothing dated can be judged.
    if (ops.status !== 'ok') throw new AppError('INVARIANT_VIOLATION', 'Station date unavailable');
    return withInventoryReadContext(
      request,
      tenantId,
      stationId,
      (transaction, context) => loadExtraAlertFacts(transaction, context, ops.value.today),
      actor,
    );
  });

  const [cash, settlements, suppliers, customers] = await Promise.all([
    section(request, 'cash', async () => {
      const summary = await getCashStationSummaryFromRequest(
        request,
        { selection: current },
        actor,
      );
      return {
        collectedButUnbanked: summary.totals.collectedButUnbanked,
        pendingBankConfirmation: summary.totals.pendingBankConfirmation,
      };
    }),
    section(request, 'settlements', async () => {
      const input = { tenantId, stationId };
      const { settlements: rows, unmatched } = await getSettlementOverviewFromRequest(
        request,
        input,
        actor,
      );
      return {
        toMatch: rows.filter((row) => row.state === 'RECORDED' || row.state === 'PARTIALLY_MATCHED')
          .length,
        exceptions: rows.filter((row) => row.state === 'EXCEPTION').length,
        unmatchedPayments: unmatched.filter((row) => !/^0+(?:\.0+)?$/.test(row.unallocatedAmount))
          .length,
        unmatchedDates: unmatched
          .filter((row) => !/^0+(?:\.0+)?$/.test(row.unallocatedAmount))
          .map((row) => row.businessDate),
      };
    }),
    section(request, 'suppliers', async () => {
      if (!current.legalEntityId) throw new AppError('FORBIDDEN', 'A legal entity is required');
      const ops = await operationsPromise;
      const rows = await getSupplierSummaryFromRequest(
        request,
        {
          tenantId,
          legalEntityId: current.legalEntityId,
          ...(ops.status === 'ok' && ops.value.settings
            ? { dueSoonDays: ops.value.settings.dueSoonDays }
            : {}),
        },
        actor,
      );
      const overdue = rows.filter((row) => !new ExactDecimal(row.overdue).value.isZero());
      const total = (pick: (row: (typeof rows)[number]) => string) =>
        rows
          .reduce((sum, row) => sum.add(new ExactDecimal(pick(row))), new ExactDecimal('0'))
          .toString();
      return {
        overdueSuppliers: overdue.length,
        overdueTotal: overdue
          .reduce((sum, row) => sum.add(new ExactDecimal(row.overdue)), new ExactDecimal('0'))
          .toString(),
        dueTodayTotal: total((row) => row.dueToday),
        dueSoonTotal: total((row) => row.dueSoon),
        dueSoonDays: rows[0]?.dueSoonDays ?? DEFAULT_ALERT_SETTINGS.dueSoonDays,
        overLimit: rows.filter((row) => row.creditLimit.status === 'over').length,
        nearLimit: rows.filter((row) => row.creditLimit.status === 'near').length,
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

  const sign = await signPromise;
  const fromSign = <K extends 'reconciliations' | 'revaluations'>(
    key: K,
  ): Section<NonNullable<NonNullable<Extract<typeof sign, { status: 'ok' }>['value']>[K]>> => {
    if (sign.status !== 'ok') return sign;
    const value = sign.value[key];
    return value ? { status: 'ok', value: value as never } : { status: 'restricted' };
  };

  const operations = await operationsPromise;
  const fromOperations = <T>(
    pick: (value: NonNullable<typeof opsValue>) => T | null,
  ): Section<T> => {
    if (operations.status !== 'ok') return operations;
    const value = pick(operations.value);
    return value ? { status: 'ok', value } : { status: 'restricted' };
  };
  const opsValue = operations.status === 'ok' ? operations.value : null;

  return {
    tenantId,
    stationId,
    reconciliations: fromSign('reconciliations'),
    revaluations: fromSign('revaluations'),
    cash,
    settlements,
    suppliers,
    customers,
    extra: await extraPromise,
    today: opsValue?.today ?? null,
    reports: fromOperations((value) => value.reports),
    stock: fromOperations((value) => (value.tanks ? { tanks: value.tanks } : null)),
    ...(opsValue?.settings ? { settings: opsValue.settings } : {}),
  };
}

export function loadActionCenterFacts(
  request: Request,
  current: CurrentContext & { stationId: string },
  actor?: AuthenticatedActorContext,
): Promise<ActionCenterFacts> {
  return withRequestReadScope(() => loadActionCenterFactsUncached(request, current, actor));
}
