import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';
import type { ForecourtTransaction } from '../forecourt/application';
import type { SettlementCommandContext } from './application';
import {
  assertA5ProviderPaymentMethod,
  assertSettlementCanBeReconciled,
  assertSettlementCanReceiveAllocation,
  calculateSettlementSummary,
  formatSettlementMoney,
} from './domain';
import type { ProviderSettlementSummaryRow, UnmatchedProviderPaymentRow } from './contracts';

type ProviderAccountRow = {
  id: string;
  provider_id: string;
  provider_status: string;
  account_reference: string;
  account_currency: string;
  account_status: string;
  account_station_id: string | null;
};

type SettlementRow = {
  id: string;
  provider_account_id: string;
  station_id: string;
  settlement_reference: string;
  batch_reference: string | null;
  transaction_date: string;
  settlement_date: string;
  currency: string;
  gross_amount: string;
  provider_fee_amount: string | null;
  provider_deduction_amount: string | null;
  reported_net_amount: string | null;
  state: 'RECORDED' | 'PARTIALLY_MATCHED' | 'RECONCILED' | 'EXCEPTION';
  version: number | string;
};

function money(value: string): ExactDecimal {
  return new ExactDecimal(value, DECIMAL_POLICIES.money);
}

function assertPositiveMoney(value: string, label: string): void {
  const parsed = money(value);
  if (!parsed.value.isPositive())
    throw new AppError('VALIDATION_FAILED', `${label} must be positive`);
}

function assertNonNegativeMoney(value: string | null | undefined, label: string): void {
  if (value === null || value === undefined) return;
  const parsed = money(value);
  if (parsed.value.isNegative())
    throw new AppError('VALIDATION_FAILED', `${label} cannot be negative`);
}

async function loadProviderAccount(
  transaction: ForecourtTransaction,
  context: SettlementCommandContext,
  providerAccountId: string,
): Promise<ProviderAccountRow> {
  const rows = await transaction.execute<ProviderAccountRow>(sql`
    select a.id,
           a.provider_id,
           p.status as provider_status,
           a.account_reference,
           a.currency as account_currency,
           a.status as account_status,
           a.station_id as account_station_id
      from app.provider_accounts a
      join app.payment_providers p
        on p.tenant_id = a.tenant_id
       and p.id = a.provider_id
     where a.tenant_id = ${context.tenantId}
       and a.id = ${providerAccountId}
     for update of a, p
  `);
  const account = rows[0];
  if (!account) throw new AppError('NOT_FOUND', 'The provider account was not found');
  if (account.account_station_id && account.account_station_id !== context.stationId) {
    throw new AppError('FORBIDDEN', 'The provider account is not configured for this station');
  }
  if (account.account_status !== 'ACTIVE' || account.provider_status !== 'ACTIVE') {
    throw new AppError('CONFLICT', 'The provider account or provider is inactive');
  }
  return account;
}

export async function createPaymentProviderInTransaction(
  transaction: ForecourtTransaction,
  context: SettlementCommandContext,
  input: {
    id: string;
    code: string;
    name: string;
    providerType: string;
    metadata: Record<string, unknown>;
  },
) {
  const existing = await transaction.execute<{ id: string }>(sql`
    select id from app.payment_providers
     where tenant_id = ${context.tenantId} and code = ${input.code}
     for update
  `);
  if (existing[0]) throw new AppError('CONFLICT', 'A provider with this code already exists');
  await transaction.execute(sql`
    insert into app.payment_providers
      (id, tenant_id, code, name, provider_type, metadata, created_by)
    values
      (${input.id}, ${context.tenantId}, ${input.code}, ${input.name}, ${input.providerType},
       ${JSON.stringify(input.metadata)}::jsonb, ${context.actor.membershipId})
  `);
  return { providerId: input.id, code: input.code };
}

export async function configureProviderAccountInTransaction(
  transaction: ForecourtTransaction,
  context: SettlementCommandContext,
  input: {
    id: string;
    providerId: string;
    accountReference: string;
    displayName: string;
    currency: string;
    stationId: string | null;
    legalEntityId: string | null;
    metadata: Record<string, unknown>;
  },
) {
  if (input.stationId && input.stationId !== context.stationId) {
    throw new AppError('FORBIDDEN', 'A provider account station must match the active station');
  }
  if (input.legalEntityId && input.legalEntityId !== context.legalEntityId) {
    throw new AppError(
      'FORBIDDEN',
      'A provider account legal entity must match the active context',
    );
  }
  const providers = await transaction.execute<{ id: string; status: string }>(sql`
    select id, status from app.payment_providers
     where tenant_id = ${context.tenantId} and id = ${input.providerId}
     for update
  `);
  const provider = providers[0];
  if (!provider) throw new AppError('NOT_FOUND', 'The payment provider was not found');
  if (provider.status !== 'ACTIVE')
    throw new AppError('CONFLICT', 'The payment provider is inactive');
  const duplicate = await transaction.execute<{ id: string }>(sql`
    select id from app.provider_accounts
     where tenant_id = ${context.tenantId}
       and provider_id = ${input.providerId}
       and account_reference = ${input.accountReference}
     for update
  `);
  if (duplicate[0])
    throw new AppError('CONFLICT', 'A provider account with this reference already exists');
  await transaction.execute(sql`
    insert into app.provider_accounts
      (id, tenant_id, provider_id, legal_entity_id, station_id, account_reference,
       display_name, currency, metadata, created_by, updated_by)
    values
      (${input.id}, ${context.tenantId}, ${input.providerId}, ${input.legalEntityId}, ${input.stationId},
       ${input.accountReference}, ${input.displayName}, ${input.currency},
       ${JSON.stringify(input.metadata)}::jsonb, ${context.actor.membershipId}, ${context.actor.membershipId})
  `);
  return { providerAccountId: input.id, accountReference: input.accountReference };
}

export async function recordProviderSettlementInTransaction(
  transaction: ForecourtTransaction,
  context: SettlementCommandContext,
  input: {
    id: string;
    providerAccountId: string;
    settlementReference: string;
    batchReference: string | null;
    transactionDate: string;
    settlementDate: string;
    currency: string;
    grossAmount: string;
    providerFeeAmount: string | null;
    providerDeductionAmount: string | null;
    reportedNetAmount: string | null;
    sourceType: string;
    sourceKey: string;
    sourceMetadata: Record<string, unknown>;
  },
) {
  if (input.transactionDate > input.settlementDate) {
    throw new AppError('VALIDATION_FAILED', 'Settlement date cannot precede transaction date');
  }
  assertPositiveMoney(input.grossAmount, 'Gross amount');
  assertNonNegativeMoney(input.providerFeeAmount, 'Provider fee amount');
  assertNonNegativeMoney(input.providerDeductionAmount, 'Provider deduction amount');
  assertNonNegativeMoney(input.reportedNetAmount, 'Reported net amount');
  const account = await loadProviderAccount(transaction, context, input.providerAccountId);
  if (account.account_currency !== input.currency) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Settlement currency must match provider account currency',
    );
  }
  const duplicate = await transaction.execute<{ id: string }>(sql`
    select id from app.provider_settlements
     where tenant_id = ${context.tenantId}
       and ((provider_account_id = ${input.providerAccountId} and settlement_reference = ${input.settlementReference})
         or source_key = ${input.sourceKey})
     for update
  `);
  if (duplicate[0])
    throw new AppError('CONFLICT', 'This provider settlement has already been recorded');
  await transaction.execute(sql`
    insert into app.provider_settlements
      (id, tenant_id, provider_account_id, station_id, settlement_reference, batch_reference,
       transaction_date, settlement_date, currency, gross_amount, provider_fee_amount,
       provider_deduction_amount, reported_net_amount, source_type, source_key,
       source_metadata, recorded_by)
    values
      (${input.id}, ${context.tenantId}, ${input.providerAccountId}, ${context.stationId},
       ${input.settlementReference}, ${input.batchReference}, ${input.transactionDate},
       ${input.settlementDate}, ${input.currency}, ${input.grossAmount}, ${input.providerFeeAmount},
       ${input.providerDeductionAmount}, ${input.reportedNetAmount}, ${input.sourceType},
       ${input.sourceKey}, ${JSON.stringify(input.sourceMetadata)}::jsonb, ${context.actor.membershipId})
  `);
  return {
    settlementId: input.id,
    settlementReference: input.settlementReference,
    state: 'RECORDED' as const,
  };
}

async function loadSettlementForUpdate(
  transaction: ForecourtTransaction,
  context: SettlementCommandContext,
  settlementId: string,
): Promise<SettlementRow> {
  const rows = await transaction.execute<SettlementRow>(sql`
    select id, provider_account_id, station_id, settlement_reference, batch_reference,
           transaction_date, settlement_date, currency, gross_amount,
           provider_fee_amount, provider_deduction_amount, reported_net_amount,
           state, version
      from app.provider_settlements
     where tenant_id = ${context.tenantId}
       and station_id = ${context.stationId}
       and id = ${settlementId}
     for update
  `);
  const settlement = rows[0];
  if (!settlement) throw new AppError('NOT_FOUND', 'The provider settlement was not found');
  return settlement;
}

async function activeSettlementAllocationTotal(
  transaction: ForecourtTransaction,
  context: SettlementCommandContext,
  settlementId: string,
): Promise<string> {
  const rows = await transaction.execute<{ amount: string }>(sql`
    select coalesce(sum(a.amount) filter (
      where a.state = 'POSTED'
        and not exists (
          select 1 from app.provider_settlement_allocations reversal
           where reversal.tenant_id = a.tenant_id
             and reversal.reversal_of_id = a.id
             and reversal.state = 'REVERSED'
        )
    ), 0)::text as amount
      from app.provider_settlement_allocations a
     where a.tenant_id = ${context.tenantId}
       and a.station_id = ${context.stationId}
       and a.settlement_id = ${settlementId}
  `);
  return rows[0]?.amount ?? '0';
}

async function activePaymentAllocationTotal(
  transaction: ForecourtTransaction,
  context: SettlementCommandContext,
  paymentId: string,
): Promise<string> {
  const rows = await transaction.execute<{ amount: string }>(sql`
    select coalesce(sum(a.amount) filter (
      where a.state = 'POSTED'
        and not exists (
          select 1 from app.provider_settlement_allocations reversal
           where reversal.tenant_id = a.tenant_id
             and reversal.reversal_of_id = a.id
             and reversal.state = 'REVERSED'
        )
    ), 0)::text as amount
      from app.provider_settlement_allocations a
     where a.tenant_id = ${context.tenantId}
       and a.station_id = ${context.stationId}
       and a.reconciliation_payment_id = ${paymentId}
  `);
  return rows[0]?.amount ?? '0';
}

export async function allocateProviderSettlementInTransaction(
  transaction: ForecourtTransaction,
  context: SettlementCommandContext,
  input: {
    id: string;
    settlementId: string;
    reconciliationPaymentId: string;
    amount: string;
    allocationKey: string;
    expectedVersion: number;
  },
) {
  assertPositiveMoney(input.amount, 'Allocation amount');

  // Lock the A5 evidence first, then the settlement. Every allocation path uses
  // this order so concurrent requests cannot double-spend either remaining side.
  const paymentRows = await transaction.execute<{
    id: string;
    station_id: string;
    reconciliation_state: string;
    method: string;
    amount: string;
  }>(sql`
    select p.id, p.station_id, r.state as reconciliation_state, p.method, p.amount
      from app.reconciliation_payments p
      join app.reconciliations r
        on r.tenant_id = p.tenant_id
       and r.station_id = p.station_id
       and r.id = p.reconciliation_id
     where p.tenant_id = ${context.tenantId}
       and p.station_id = ${context.stationId}
       and p.id = ${input.reconciliationPaymentId}
     for update of p, r
  `);
  const payment = paymentRows[0];
  if (!payment) throw new AppError('NOT_FOUND', 'The A5 payment evidence was not found');
  assertA5ProviderPaymentMethod(payment.method);
  if (!['APPROVED', 'POSTED', 'LOCKED'].includes(payment.reconciliation_state)) {
    throw new AppError(
      'CONFLICT',
      'Only approved or posted A5 reconciliation evidence can be matched',
    );
  }

  const settlement = await loadSettlementForUpdate(transaction, context, input.settlementId);
  assertSettlementCanReceiveAllocation(settlement.state);
  if (settlement.currency !== 'USD') {
    throw new AppError(
      'VALIDATION_FAILED',
      'A5 provider evidence is currently supported only in USD',
    );
  }
  if (Number(settlement.version) !== input.expectedVersion) {
    throw new AppError('CONFLICT', 'The provider settlement is stale', {
      expectedVersion: input.expectedVersion,
      actualVersion: Number(settlement.version),
    });
  }
  const account = await loadProviderAccount(transaction, context, settlement.provider_account_id);
  if (account.account_currency !== settlement.currency) {
    throw new AppError('VALIDATION_FAILED', 'Settlement and provider account currencies differ');
  }

  const paymentAllocated = await activePaymentAllocationTotal(transaction, context, payment.id);
  const settlementAllocated = await activeSettlementAllocationTotal(
    transaction,
    context,
    settlement.id,
  );
  if (money(paymentAllocated).add(money(input.amount)).value.gt(payment.amount)) {
    throw new AppError(
      'CONFLICT',
      'The allocation exceeds the remaining A5 payment evidence amount',
    );
  }
  if (money(settlementAllocated).add(money(input.amount)).value.gt(settlement.gross_amount)) {
    throw new AppError(
      'CONFLICT',
      'The allocation exceeds the remaining provider settlement amount',
    );
  }

  const duplicate = await transaction.execute<{ id: string }>(sql`
    select id from app.provider_settlement_allocations
     where tenant_id = ${context.tenantId} and allocation_key = ${input.allocationKey}
     for update
  `);
  if (duplicate[0]) throw new AppError('CONFLICT', 'This settlement allocation key already exists');
  await transaction.execute(sql`
    insert into app.provider_settlement_allocations
      (id, tenant_id, station_id, settlement_id, reconciliation_payment_id,
       amount, allocation_key, state, allocated_by)
    values
      (${input.id}, ${context.tenantId}, ${context.stationId}, ${settlement.id},
       ${payment.id}, ${input.amount}, ${input.allocationKey}, 'POSTED', ${context.actor.membershipId})
  `);
  await transaction.execute(sql`
    update app.provider_settlements
       set state = 'PARTIALLY_MATCHED', version = version + 1, updated_at = now()
     where tenant_id = ${context.tenantId}
       and station_id = ${context.stationId}
       and id = ${settlement.id}
       and version = ${input.expectedVersion}
  `);
  return {
    allocationId: input.id,
    settlementId: settlement.id,
    reconciliationPaymentId: payment.id,
    amount: input.amount,
    state: 'POSTED' as const,
    settlementVersion: input.expectedVersion + 1,
  };
}

export async function reverseProviderSettlementAllocationInTransaction(
  transaction: ForecourtTransaction,
  context: SettlementCommandContext,
  input: {
    id: string;
    allocationId: string;
    reversalKey: string;
    expectedVersion: number;
  },
) {
  const originals = await transaction.execute<{
    id: string;
    settlement_id: string;
    reconciliation_payment_id: string;
    amount: string;
    state: string;
  }>(sql`
    select id, settlement_id, reconciliation_payment_id, amount, state
      from app.provider_settlement_allocations
     where tenant_id = ${context.tenantId}
       and station_id = ${context.stationId}
       and id = ${input.allocationId}
     for update
  `);
  const original = originals[0];
  if (!original) throw new AppError('NOT_FOUND', 'The settlement allocation was not found');
  if (original.state !== 'POSTED')
    throw new AppError('CONFLICT', 'Only a posted allocation can be reversed');
  const paymentRows = await transaction.execute<{ id: string }>(sql`
    select id
      from app.reconciliation_payments
     where tenant_id = ${context.tenantId}
       and station_id = ${context.stationId}
       and id = ${original.reconciliation_payment_id}
     for update
  `);
  if (!paymentRows[0]) throw new AppError('NOT_FOUND', 'The A5 payment evidence was not found');
  const settlement = await loadSettlementForUpdate(transaction, context, original.settlement_id);
  if (Number(settlement.version) !== input.expectedVersion) {
    throw new AppError('CONFLICT', 'The provider settlement is stale', {
      expectedVersion: input.expectedVersion,
      actualVersion: Number(settlement.version),
    });
  }
  const existing = await transaction.execute<{ id: string }>(sql`
    select id from app.provider_settlement_allocations
     where tenant_id = ${context.tenantId}
       and reversal_of_id = ${original.id}
       and state = 'REVERSED'
     for update
  `);
  if (existing[0]) throw new AppError('CONFLICT', 'The settlement allocation is already reversed');
  await transaction.execute(sql`
    insert into app.provider_settlement_allocations
      (id, tenant_id, station_id, settlement_id, reconciliation_payment_id,
       amount, allocation_key, state, reversal_of_id, allocated_by)
    values
      (${input.id}, ${context.tenantId}, ${context.stationId}, ${original.settlement_id},
       ${original.reconciliation_payment_id}, ${original.amount}, ${input.reversalKey},
       'REVERSED', ${original.id}, ${context.actor.membershipId})
  `);
  await transaction.execute(sql`
    update app.provider_settlements
       set state = 'EXCEPTION', version = version + 1, updated_at = now()
     where tenant_id = ${context.tenantId}
       and station_id = ${context.stationId}
       and id = ${settlement.id}
       and version = ${input.expectedVersion}
  `);
  return {
    reversalId: input.id,
    allocationId: original.id,
    settlementId: settlement.id,
    state: 'REVERSED' as const,
    settlementVersion: input.expectedVersion + 1,
  };
}

export async function reconcileProviderSettlementInTransaction(
  transaction: ForecourtTransaction,
  context: SettlementCommandContext,
  input: { settlementId: string; expectedVersion: number; reason: string | null },
) {
  const settlement = await loadSettlementForUpdate(transaction, context, input.settlementId);
  assertSettlementCanBeReconciled(settlement.state);
  if (Number(settlement.version) !== input.expectedVersion) {
    throw new AppError('CONFLICT', 'The provider settlement is stale', {
      expectedVersion: input.expectedVersion,
      actualVersion: Number(settlement.version),
    });
  }
  const allocatedAmount = await activeSettlementAllocationTotal(
    transaction,
    context,
    settlement.id,
  );
  const hasVariance = !money(allocatedAmount).value.eq(settlement.gross_amount);
  if (hasVariance && !input.reason?.trim()) {
    throw new AppError('VALIDATION_FAILED', 'A reason is required when reconciling a variance');
  }
  const state = hasVariance ? 'EXCEPTION' : 'RECONCILED';
  await transaction.execute(sql`
    update app.provider_settlements
       set state = ${state}, reconciled_by = ${context.actor.membershipId},
           reconciled_at = now(), version = version + 1, updated_at = now()
     where tenant_id = ${context.tenantId}
       and station_id = ${context.stationId}
       and id = ${settlement.id}
       and version = ${input.expectedVersion}
  `);
  return {
    settlementId: settlement.id,
    state,
    allocatedAmount,
    varianceAmount: money(settlement.gross_amount).subtract(money(allocatedAmount)).toString(),
    version: input.expectedVersion + 1,
  };
}

function mapSettlementSummary(row: ProviderSettlementSummaryRow): ProviderSettlementSummaryRow {
  return row;
}

export async function listProviderSettlementSummariesInTransaction(
  transaction: ForecourtTransaction,
  context: SettlementCommandContext,
): Promise<ProviderSettlementSummaryRow[]> {
  const rows = await transaction.execute<ProviderSettlementSummaryRow>(sql`
    select s.id as "settlementId",
           p.id as "providerId",
           p.code as "providerCode",
           p.name as "providerName",
           a.id as "providerAccountId",
           a.account_reference as "accountReference",
           s.station_id as "stationId",
           s.settlement_reference as "settlementReference",
           s.batch_reference as "batchReference",
           s.transaction_date as "transactionDate",
           s.settlement_date as "settlementDate",
           s.currency,
           s.gross_amount::text as "grossAmount",
           coalesce(sum(x.amount) filter (
             where x.state = 'POSTED'
               and not exists (
                 select 1 from app.provider_settlement_allocations xr
                  where xr.tenant_id = x.tenant_id
                    and xr.reversal_of_id = x.id
                    and xr.state = 'REVERSED'
               )
           ), 0)::text as "allocatedAmount",
           s.provider_fee_amount::text as "providerFeeAmount",
           s.provider_deduction_amount::text as "providerDeductionAmount",
           s.reported_net_amount::text as "reportedNetAmount",
           s.state,
           s.version
      from app.provider_settlements s
      join app.provider_accounts a on a.tenant_id = s.tenant_id and a.id = s.provider_account_id
      join app.payment_providers p on p.tenant_id = a.tenant_id and p.id = a.provider_id
      left join app.provider_settlement_allocations x
        on x.tenant_id = s.tenant_id and x.station_id = s.station_id and x.settlement_id = s.id
     where s.tenant_id = ${context.tenantId} and s.station_id = ${context.stationId}
     group by s.id, p.id, p.code, p.name, a.id, a.account_reference,
              s.station_id, s.settlement_reference, s.batch_reference,
              s.transaction_date, s.settlement_date, s.currency, s.gross_amount,
              s.provider_fee_amount, s.provider_deduction_amount, s.reported_net_amount,
              s.state, s.version
     order by s.settlement_date desc, s.id desc
  `);
  return rows.map((row) => {
    const summary = calculateSettlementSummary({
      grossAmount: row.grossAmount,
      allocatedAmount: row.allocatedAmount,
      providerFeeAmount: row.providerFeeAmount,
      providerDeductionAmount: row.providerDeductionAmount,
      reportedNetAmount: row.reportedNetAmount,
      state: row.state,
    });
    return mapSettlementSummary({
      ...row,
      ...summary,
      expectedEvidenceAmount: formatSettlementMoney(row.allocatedAmount),
      unmatchedEvidenceAmount: formatSettlementMoney('0'),
    });
  });
}

export async function listUnmatchedProviderPaymentsInTransaction(
  transaction: ForecourtTransaction,
  context: SettlementCommandContext,
): Promise<UnmatchedProviderPaymentRow[]> {
  const rows = await transaction.execute<UnmatchedProviderPaymentRow>(sql`
    select p.id as "paymentId",
           p.station_id as "stationId",
           p.reconciliation_id as "reconciliationId",
           r.state as "reconciliationState",
           bd.business_date as "businessDate",
           p.method,
           p.amount::text as amount,
           coalesce(sum(a.amount) filter (
             where a.state = 'POSTED'
               and not exists (
                 select 1 from app.provider_settlement_allocations ar
                  where ar.tenant_id = a.tenant_id
                    and ar.reversal_of_id = a.id
                    and ar.state = 'REVERSED'
               )
           ), 0)::text as "allocatedAmount",
           p.reference
      from app.reconciliation_payments p
      join app.reconciliations r
        on r.tenant_id = p.tenant_id and r.station_id = p.station_id and r.id = p.reconciliation_id
      join app.station_business_days bd
        on bd.tenant_id = r.tenant_id and bd.station_id = r.station_id and bd.id = r.business_day_id
      left join app.provider_settlement_allocations a
        on a.tenant_id = p.tenant_id and a.station_id = p.station_id and a.reconciliation_payment_id = p.id
     where p.tenant_id = ${context.tenantId}
       and p.station_id = ${context.stationId}
       and p.method in ('POS','ECOCASH')
       and r.state in ('APPROVED','POSTED','LOCKED')
     group by p.id, p.station_id, p.reconciliation_id, r.state, bd.business_date,
              p.method, p.amount, p.reference
     having coalesce(sum(a.amount) filter (
       where a.state = 'POSTED'
         and not exists (
           select 1 from app.provider_settlement_allocations ar
            where ar.tenant_id = a.tenant_id
              and ar.reversal_of_id = a.id
              and ar.state = 'REVERSED'
         )
     ), 0) < p.amount
     order by bd.business_date desc, p.id desc
  `);
  return rows.map((row) => ({
    ...row,
    amount: formatSettlementMoney(row.amount),
    allocatedAmount: formatSettlementMoney(row.allocatedAmount),
    unallocatedAmount: formatSettlementMoney(
      money(row.amount).subtract(money(row.allocatedAmount)).toString(),
    ),
  }));
}
