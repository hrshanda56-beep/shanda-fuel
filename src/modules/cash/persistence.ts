import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import { ExactDecimal } from '../../platform/domain/primitives';
import { applyCashHandoverCommand, type CashHandoverRecord } from './handover-domain';
import {
  calculateBankDepositAmount,
  calculateCashCount,
  calculateCashCollectionAmount,
  remainingCashAmount,
  type BankDepositAllocation,
  type CashCollectionSource,
} from './domain';
import type { CashCommandContext } from './application';
import type { ForecourtTransaction } from '../forecourt/application';

type SourceRow = {
  reconciliation_id: string;
  business_date: string;
  counted_cash: string;
  allocated_cash: string;
};

type CollectionRow = {
  id: string;
  station_id: string;
  collection_reference: string;
  source_location_id: string;
  current_location_id: string;
  amount: string;
  business_date: string;
  state: string;
  version: number | string;
};

type HandoverRow = {
  id: string;
  from_location_id: string;
  to_location_id: string;
  transit_location_id: string;
  business_date: string;
  expected_amount: string;
  counted_amount: string | null;
  variance: string | null;
  variance_explanation: string | null;
  state: string;
  delivered_by: string;
  received_by: string | null;
  dispute_reason: string | null;
  resolution_reason: string | null;
  cancellation_reason: string | null;
  version: number | string;
};

function decimal(value: string): ExactDecimal {
  return new ExactDecimal(value);
}

async function assertActiveCashLocation(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  locationId: string,
): Promise<void> {
  const rows = await transaction.execute<{ id: string }>(sql`
    select id
    from app.cash_locations
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and id = ${locationId}
      and status = 'ACTIVE'
    for update
  `);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'The cash location was not found or is inactive');
}

async function assertTransitCashLocation(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  locationId: string,
): Promise<void> {
  const rows = await transaction.execute<{ id: string }>(sql`
    select id
    from app.cash_locations
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and id = ${locationId}
      and location_type = 'TRANSIT'
      and status = 'ACTIVE'
    for update
  `);
  if (!rows[0])
    throw new AppError('NOT_FOUND', 'The transit cash location was not found or is inactive');
}

async function cashLocationBalance(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  locationId: string,
  businessDate: string,
): Promise<ExactDecimal> {
  const rows = await transaction.execute<{
    amount: string;
    from_location_id: string | null;
    to_location_id: string | null;
  }>(sql`
    select amount::text, from_location_id, to_location_id
    from app.cash_movements
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and business_date <= ${businessDate}
      and effective_at <= now()
      and (from_location_id = ${locationId} or to_location_id = ${locationId})
    order by effective_at, id
    for update
  `);
  let balance = new ExactDecimal('0');
  for (const row of rows) {
    const amount = decimal(row.amount);
    if (row.to_location_id === locationId) balance = balance.add(amount);
    if (row.from_location_id === locationId) balance = balance.subtract(amount);
  }
  if (balance.value.lt(0)) {
    throw new AppError('CONFLICT', 'The custody ledger has a negative balance', {
      locationId,
      balance: balance.toString(),
    });
  }
  return balance;
}

function handoverRecord(row: HandoverRow): CashHandoverRecord {
  return {
    state: row.state as CashHandoverRecord['state'],
    deliveredBy: row.delivered_by,
    receivedBy: row.received_by,
    expectedAmount: row.expected_amount,
    countedAmount: row.counted_amount,
    variance: row.variance,
    varianceExplanation: row.variance_explanation,
    disputeReason: row.dispute_reason,
    resolutionReason: row.resolution_reason,
    cancellationReason: row.cancellation_reason,
  };
}

async function loadHandover(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  handoverId: string,
): Promise<HandoverRow> {
  const rows = await transaction.execute<HandoverRow>(sql`
    select id, from_location_id, to_location_id, transit_location_id, business_date,
           expected_amount::text, counted_amount::text, variance::text,
           variance_explanation, state, delivered_by, received_by, dispute_reason,
           resolution_reason, cancellation_reason, version
    from app.cash_handovers
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and id = ${handoverId}
    for update
  `);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'The cash handover was not found');
  return rows[0];
}

async function insertHandoverMovement(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  handover: HandoverRow,
  fromLocationId: string,
  toLocationId: string,
  sourceType: string,
): Promise<void> {
  await transaction.execute(sql`
    insert into app.cash_movements (
      id, tenant_id, station_id, movement_type, amount, currency,
      from_location_id, to_location_id, source_type, source_id,
      business_date, effective_at, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.stationId}, 'TRANSFER',
      ${handover.expected_amount}, 'USD', ${fromLocationId}, ${toLocationId},
      ${sourceType}, ${handover.id}, ${handover.business_date}, now(),
      ${context.actor.membershipId}
    )
  `);
}

export async function prepareCashHandoverInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: {
    fromLocationId: string;
    toLocationId: string;
    transitLocationId: string;
    businessDate: string;
    expectedAmount: string;
  },
) {
  if (input.fromLocationId === input.toLocationId) {
    throw new AppError('VALIDATION_FAILED', 'A cash handover must change location');
  }
  await assertActiveCashLocation(transaction, context, input.fromLocationId);
  await assertActiveCashLocation(transaction, context, input.toLocationId);
  await assertTransitCashLocation(transaction, context, input.transitLocationId);
  const available = await cashLocationBalance(
    transaction,
    context,
    input.fromLocationId,
    input.businessDate,
  );
  const prepared = applyCashHandoverCommand(null, {
    type: 'PrepareHandover',
    deliveredBy: context.actor.membershipId,
    expectedAmount: input.expectedAmount,
  });
  if (new ExactDecimal(prepared.expectedAmount).value.gt(available.value)) {
    throw new AppError(
      'CONFLICT',
      'The handover amount exceeds cash available at the source location',
      {
        availableAmount: available.toString(),
        requestedAmount: prepared.expectedAmount,
      },
    );
  }
  const handoverId = randomUUID();
  await transaction.execute(sql`
    insert into app.cash_handovers (
      id, tenant_id, station_id, from_location_id, to_location_id, transit_location_id,
      business_date, expected_amount, currency, state, delivered_by
    ) values (
      ${handoverId}, ${context.tenantId}, ${context.stationId}, ${input.fromLocationId},
      ${input.toLocationId}, ${input.transitLocationId}, ${input.businessDate},
      ${prepared.expectedAmount}, 'USD', 'DRAFT', ${context.actor.membershipId}
    )
  `);
  return {
    handoverId,
    state: 'DRAFT' as const,
    version: 0,
    expectedAmount: prepared.expectedAmount,
  };
}

export async function senderConfirmCashHandoverInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: {
    handoverId: string;
    expectedVersion: number;
    countedAmount: string;
    varianceExplanation?: string;
  },
) {
  const current = await loadHandover(transaction, context, input.handoverId);
  if (Number(current.version) !== input.expectedVersion)
    throw new AppError('CONFLICT', 'The cash handover is stale');
  const next = applyCashHandoverCommand(handoverRecord(current), {
    type: 'SenderConfirmHandover',
    countedAmount: input.countedAmount,
    varianceExplanation: input.varianceExplanation,
  });
  await insertHandoverMovement(
    transaction,
    context,
    current,
    current.from_location_id,
    current.transit_location_id,
    'CASH_HANDOVER_TRANSIT',
  );
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.cash_handovers
    set state = 'SUBMITTED', counted_amount = ${next.countedAmount}, variance = ${next.variance},
        variance_explanation = ${next.varianceExplanation}, submitted_at = now(), version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and id = ${current.id} and version = ${input.expectedVersion} and state = 'DRAFT'
    returning version
  `);
  if (!updated[0]) throw new AppError('CONFLICT', 'The cash handover became stale');
  return {
    handoverId: current.id,
    state: next.state,
    version: Number(updated[0].version),
    variance: next.variance,
  };
}

export async function receiverConfirmCashHandoverInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: { handoverId: string; expectedVersion: number },
) {
  const current = await loadHandover(transaction, context, input.handoverId);
  if (Number(current.version) !== input.expectedVersion)
    throw new AppError('CONFLICT', 'The cash handover is stale');
  const next = applyCashHandoverCommand(handoverRecord(current), {
    type: 'ReceiverConfirmHandover',
    receivedBy: context.actor.membershipId,
  });
  await insertHandoverMovement(
    transaction,
    context,
    current,
    current.transit_location_id,
    current.to_location_id,
    'CASH_HANDOVER_FINAL',
  );
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.cash_handovers
    set state = 'ACCEPTED', received_by = ${next.receivedBy}, accepted_at = now(), version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and id = ${current.id} and version = ${input.expectedVersion} and state = 'SUBMITTED'
    returning version
  `);
  if (!updated[0]) throw new AppError('CONFLICT', 'The cash handover became stale');
  return { handoverId: current.id, state: next.state, version: Number(updated[0].version) };
}

export async function disputeCashHandoverInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: {
    handoverId: string;
    expectedVersion: number;
    reason: string;
    varianceExplanation?: string;
  },
) {
  const current = await loadHandover(transaction, context, input.handoverId);
  if (Number(current.version) !== input.expectedVersion)
    throw new AppError('CONFLICT', 'The cash handover is stale');
  const next = applyCashHandoverCommand(handoverRecord(current), {
    type: 'DisputeHandover',
    receivedBy: context.actor.membershipId,
    reason: input.reason,
    varianceExplanation: input.varianceExplanation,
  });
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.cash_handovers
    set state = 'DISPUTED', received_by = ${next.receivedBy}, dispute_reason = ${next.disputeReason},
        variance_explanation = ${next.varianceExplanation}, version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and id = ${current.id} and version = ${input.expectedVersion} and state = 'SUBMITTED'
    returning version
  `);
  if (!updated[0]) throw new AppError('CONFLICT', 'The cash handover became stale');
  return { handoverId: current.id, state: next.state, version: Number(updated[0].version) };
}

export async function resolveCashHandoverDisputeInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: { handoverId: string; expectedVersion: number; reason: string },
) {
  const current = await loadHandover(transaction, context, input.handoverId);
  if (Number(current.version) !== input.expectedVersion)
    throw new AppError('CONFLICT', 'The cash handover is stale');
  const next = applyCashHandoverCommand(handoverRecord(current), {
    type: 'ResolveHandoverDispute',
    reason: input.reason,
  });
  await insertHandoverMovement(
    transaction,
    context,
    current,
    current.transit_location_id,
    current.to_location_id,
    'CASH_HANDOVER_FINAL',
  );
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.cash_handovers
    set state = 'RESOLVED', resolution_reason = ${next.resolutionReason}, version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and id = ${current.id} and version = ${input.expectedVersion} and state = 'DISPUTED'
    returning version
  `);
  if (!updated[0]) throw new AppError('CONFLICT', 'The cash handover became stale');
  return { handoverId: current.id, state: next.state, version: Number(updated[0].version) };
}

export async function cancelCashHandoverInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: { handoverId: string; expectedVersion: number; reason: string },
) {
  const current = await loadHandover(transaction, context, input.handoverId);
  if (Number(current.version) !== input.expectedVersion)
    throw new AppError('CONFLICT', 'The cash handover is stale');
  const next = applyCashHandoverCommand(handoverRecord(current), {
    type: 'CancelHandover',
    reason: input.reason,
  });
  if (current.state !== 'DRAFT') {
    await insertHandoverMovement(
      transaction,
      context,
      current,
      current.transit_location_id,
      current.from_location_id,
      'CASH_HANDOVER_CANCEL',
    );
  }
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.cash_handovers
    set state = 'CANCELLED', cancellation_reason = ${next.cancellationReason}, version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and id = ${current.id} and version = ${input.expectedVersion} and state = ${current.state}
    returning version
  `);
  if (!updated[0]) throw new AppError('CONFLICT', 'The cash handover became stale');
  return { handoverId: current.id, state: next.state, version: Number(updated[0].version) };
}

export async function recordCashCountInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: {
    locationId: string;
    businessDate: string;
    countedAmount: string;
    explanation?: string;
  },
) {
  await assertActiveCashLocation(transaction, context, input.locationId);

  const movementRows = await transaction.execute<{
    id: string;
    amount: string;
    from_location_id: string | null;
    to_location_id: string | null;
  }>(sql`
    select id, amount::text, from_location_id, to_location_id
    from app.cash_movements
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and business_date <= ${input.businessDate}
      and effective_at <= now()
      and (from_location_id = ${input.locationId} or to_location_id = ${input.locationId})
    order by effective_at, id
    for update
  `);

  let expectedAmount = new ExactDecimal('0');
  for (const movement of movementRows) {
    const amount = decimal(movement.amount);
    if (movement.to_location_id === input.locationId) expectedAmount = expectedAmount.add(amount);
    if (movement.from_location_id === input.locationId)
      expectedAmount = expectedAmount.subtract(amount);
  }

  if (expectedAmount.value.lt(0)) {
    throw new AppError(
      'CONFLICT',
      'The custody ledger has a negative expected cash balance at this location',
      { locationId: input.locationId, expectedAmount: expectedAmount.toString() },
    );
  }

  const count = calculateCashCount({
    expectedAmount: expectedAmount.toString(),
    countedAmount: input.countedAmount,
    explanation: input.explanation,
  });

  const countId = randomUUID();
  await transaction.execute(sql`
    insert into app.cash_counts (
      id, tenant_id, station_id, location_id, business_date, counted_at,
      expected_amount, counted_amount, variance, currency, explanation, counted_by
    ) values (
      ${countId}, ${context.tenantId}, ${context.stationId}, ${input.locationId},
      ${input.businessDate}, now(), ${count.expectedAmount}, ${count.countedAmount},
      ${count.variance}, 'USD', ${input.explanation?.trim() || null}, ${context.actor.membershipId}
    )
  `);

  return {
    countId,
    locationId: input.locationId,
    businessDate: input.businessDate,
    expectedAmount: count.expectedAmount,
    countedAmount: count.countedAmount,
    variance: count.variance,
    currency: 'USD' as const,
  };
}

async function loadCollection(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  collectionId: string,
): Promise<CollectionRow> {
  const rows = await transaction.execute<CollectionRow>(sql`
    select id, station_id, collection_reference, source_location_id, current_location_id,
           amount, business_date, state, version
    from app.cash_collections
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and id = ${collectionId}
    for update
  `);
  const collection = rows[0];
  if (!collection) throw new AppError('NOT_FOUND', 'The cash collection was not found');
  return collection;
}

async function collectionAllocationTotals(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  collectionId: string,
): Promise<{ allocated: string; confirmed: string }> {
  const rows = await transaction.execute<{ allocated: string; confirmed: string }>(sql`
    select
      coalesce(sum(case when d.state <> 'REVERSED' then a.amount else 0 end), 0)::text as allocated,
      coalesce(sum(case when d.state = 'CONFIRMED' then a.amount else 0 end), 0)::text as confirmed
    from app.bank_deposit_allocations a
    join app.bank_deposits d
      on d.tenant_id = a.tenant_id
     and d.station_id = a.station_id
     and d.id = a.deposit_id
    where a.tenant_id = ${context.tenantId}
      and a.station_id = ${context.stationId}
      and a.collection_id = ${collectionId}
  `);
  return rows[0] ?? { allocated: '0', confirmed: '0' };
}

export async function recordCashCollectionInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: {
    collectionReference: string;
    sourceLocationId: string;
    sources: readonly { reconciliationId: string; amount: string }[];
  },
) {
  await assertActiveCashLocation(transaction, context, input.sourceLocationId);

  const sourceRows: SourceRow[] = [];
  const sourceIds = new Set<string>();
  for (const source of input.sources) {
    if (sourceIds.has(source.reconciliationId)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'A reconciliation may appear only once per collection',
      );
    }
    sourceIds.add(source.reconciliationId);
    const rows = await transaction.execute<SourceRow>(sql`
      select r.id as reconciliation_id,
             bd.business_date,
             cd.counted_cash::text as counted_cash,
             coalesce((
               select sum(a.amount)
               from app.cash_collection_allocations a
               where a.tenant_id = r.tenant_id
                 and a.station_id = r.station_id
                 and a.reconciliation_id = r.id
             ), 0)::text as allocated_cash
      from app.reconciliations r
      join app.station_business_days bd
        on bd.tenant_id = r.tenant_id
       and bd.station_id = r.station_id
       and bd.id = r.business_day_id
      join app.reconciliation_cash_declarations cd
        on cd.tenant_id = r.tenant_id
       and cd.station_id = r.station_id
       and cd.reconciliation_id = r.id
      where r.tenant_id = ${context.tenantId}
        and r.station_id = ${context.stationId}
        and r.id = ${source.reconciliationId}
        and r.state in ('APPROVED', 'POSTED', 'LOCKED')
      for update of r, cd
    `);
    const row = rows[0];
    if (!row) {
      throw new AppError(
        'CONFLICT',
        'Only approved A5 reconciliations with cash evidence can fund a collection',
        { reconciliationId: source.reconciliationId },
      );
    }
    sourceRows.push(row);
  }

  const businessDate = sourceRows[0]?.business_date;
  if (!businessDate || sourceRows.some((row) => row.business_date !== businessDate)) {
    throw new AppError('VALIDATION_FAILED', 'A collection must use one business date');
  }

  const sourceValues: CashCollectionSource[] = input.sources.map((source, index) => {
    const row = sourceRows[index]!;
    return {
      reconciliationId: source.reconciliationId,
      amount: source.amount,
      availableAmount: decimal(row.counted_cash).subtract(decimal(row.allocated_cash)).toString(),
    };
  });
  const amount = calculateCashCollectionAmount(sourceValues);
  const collectionId = randomUUID();

  await transaction.execute(sql`
    insert into app.cash_collections (
      id, tenant_id, station_id, collection_reference, source_location_id,
      current_location_id, amount, currency, business_date, state, recorded_by
    ) values (
      ${collectionId}, ${context.tenantId}, ${context.stationId}, ${input.collectionReference},
      ${input.sourceLocationId}, ${input.sourceLocationId}, ${amount}, 'USD', ${businessDate},
      'RECORDED', ${context.actor.membershipId}
    )
  `);

  for (const source of input.sources) {
    await transaction.execute(sql`
      insert into app.cash_collection_allocations (
        id, tenant_id, station_id, collection_id, reconciliation_id, amount, currency, allocated_by
      ) values (
        ${randomUUID()}, ${context.tenantId}, ${context.stationId}, ${collectionId},
        ${source.reconciliationId}, ${source.amount}, 'USD', ${context.actor.membershipId}
      )
    `);
  }

  return {
    collectionId,
    collectionReference: input.collectionReference,
    amount,
    state: 'RECORDED' as const,
    businessDate,
    collectedButUnbanked: amount,
  };
}

export async function receiveCashCollectionInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: { collectionId: string; targetLocationId: string; expectedVersion: number },
) {
  const collection = await loadCollection(transaction, context, input.collectionId);
  if (collection.state !== 'RECORDED') {
    throw new AppError('CONFLICT', 'Only a recorded cash collection can be received');
  }
  if (Number(collection.version) !== input.expectedVersion) {
    throw new AppError('CONFLICT', 'The cash collection is stale', {
      expectedVersion: input.expectedVersion,
      actualVersion: Number(collection.version),
    });
  }
  if (collection.current_location_id === input.targetLocationId) {
    throw new AppError('VALIDATION_FAILED', 'The custody location must change on receipt');
  }
  await assertActiveCashLocation(transaction, context, input.targetLocationId);

  await transaction.execute(sql`
    insert into app.cash_movements (
      id, tenant_id, station_id, movement_type, amount, currency,
      from_location_id, to_location_id, source_type, source_id,
      business_date, effective_at, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.stationId}, 'TRANSFER', ${collection.amount}, 'USD',
      ${collection.current_location_id}, ${input.targetLocationId}, 'CASH_COLLECTION_RECEIPT',
      ${collection.id}, ${collection.business_date}, now(), ${context.actor.membershipId}
    )
  `);

  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.cash_collections
    set current_location_id = ${input.targetLocationId},
        state = 'RECEIVED',
        received_by = ${context.actor.membershipId},
        received_at = now(),
        version = version + 1,
        updated_at = now()
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and id = ${input.collectionId}
      and version = ${input.expectedVersion}
      and state = 'RECORDED'
    returning version
  `);
  if (!updated[0]) throw new AppError('CONFLICT', 'The cash collection became stale');
  return {
    collectionId: collection.id,
    state: 'RECEIVED' as const,
    currentLocationId: input.targetLocationId,
    version: Number(updated[0].version),
  };
}

export async function createBankDepositInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: {
    bankAccountId: string;
    sourceLocationId: string;
    depositReference: string;
    allocations: readonly { collectionId: string; amount: string }[];
  },
) {
  await assertActiveCashLocation(transaction, context, input.sourceLocationId);
  const bankRows = await transaction.execute<{ id: string }>(sql`
    select id
    from app.bank_accounts
    where tenant_id = ${context.tenantId}
      and legal_entity_id = ${context.legalEntityId}
      and id = ${input.bankAccountId}
      and status = 'ACTIVE'
      and currency = 'USD'
  `);
  if (!bankRows[0])
    throw new AppError('NOT_FOUND', 'The bank account was not found or is inactive');

  const allocationValues: BankDepositAllocation[] = [];
  for (const allocation of input.allocations) {
    const collection = await loadCollection(transaction, context, allocation.collectionId);
    if (collection.state === 'REVERSED') {
      throw new AppError('CONFLICT', 'A reversed cash collection cannot be deposited');
    }
    if (collection.current_location_id !== input.sourceLocationId) {
      throw new AppError('CONFLICT', 'All deposited collections must be at the source location', {
        collectionId: collection.id,
      });
    }
    const totals = await collectionAllocationTotals(transaction, context, collection.id);
    const unbanked = remainingCashAmount(collection.amount, totals.allocated);
    allocationValues.push({
      collectionId: collection.id,
      amount: allocation.amount,
      unbankedAmount: unbanked,
    });
  }
  const amount = calculateBankDepositAmount(allocationValues);
  const depositId = randomUUID();

  await transaction.execute(sql`
    insert into app.bank_deposits (
      id, tenant_id, station_id, source_location_id, bank_account_id, amount,
      currency, deposit_reference, state, deposited_at, recorded_by
    ) values (
      ${depositId}, ${context.tenantId}, ${context.stationId}, ${input.sourceLocationId},
      ${input.bankAccountId}, ${amount}, 'USD', ${input.depositReference}, 'RECORDED',
      now(), ${context.actor.membershipId}
    )
  `);

  for (const allocation of input.allocations) {
    await transaction.execute(sql`
      insert into app.bank_deposit_allocations (
        id, tenant_id, station_id, deposit_id, collection_id, amount, currency, allocated_by
      ) values (
        ${randomUUID()}, ${context.tenantId}, ${context.stationId}, ${depositId},
        ${allocation.collectionId}, ${allocation.amount}, 'USD', ${context.actor.membershipId}
      )
    `);
  }

  await transaction.execute(sql`
    insert into app.cash_movements (
      id, tenant_id, station_id, movement_type, amount, currency,
      from_location_id, to_location_id, source_type, source_id,
      business_date, effective_at, actor_membership_id
    )
    select ${randomUUID()}, ${context.tenantId}, ${context.stationId}, 'DISBURSEMENT', ${amount}, 'USD',
           ${input.sourceLocationId}, null, 'BANK_DEPOSIT', ${depositId},
           min(c.business_date), now(), ${context.actor.membershipId}
    from app.cash_collections c
    where c.tenant_id = ${context.tenantId}
      and c.station_id = ${context.stationId}
      and c.id in (${sql.join(
        input.allocations.map((item) => sql`${item.collectionId}`),
        sql`, `,
      )})
  `);

  return {
    depositId,
    depositReference: input.depositReference,
    amount,
    state: 'RECORDED' as const,
    allocationCount: input.allocations.length,
  };
}

export async function confirmBankDepositInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: {
    depositId: string;
    expectedVersion: number;
    confirmedAmount: string;
    bankReference: string;
  },
) {
  const rows = await transaction.execute<{
    id: string;
    amount: string;
    state: string;
    version: number | string;
  }>(sql`
    select id, amount, state, version
    from app.bank_deposits
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and id = ${input.depositId}
    for update
  `);
  const deposit = rows[0];
  if (!deposit) throw new AppError('NOT_FOUND', 'The bank deposit was not found');
  if (deposit.state !== 'RECORDED' && deposit.state !== 'SUBMITTED') {
    throw new AppError('CONFLICT', 'Only an unconfirmed bank deposit can be confirmed');
  }
  if (Number(deposit.version) !== input.expectedVersion) {
    throw new AppError('CONFLICT', 'The bank deposit is stale', {
      expectedVersion: input.expectedVersion,
      actualVersion: Number(deposit.version),
    });
  }
  const confirmed = decimal(input.confirmedAmount);
  if (confirmed.value.lt(0)) {
    throw new AppError('VALIDATION_FAILED', 'Confirmed deposit amount cannot be negative');
  }
  const variance = confirmed.subtract(decimal(deposit.amount)).toString();
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.bank_deposits
    set state = 'CONFIRMED',
        confirmed_amount = ${confirmed.toString()},
        confirmation_variance = ${variance},
        bank_reference = ${input.bankReference},
        confirmed_by = ${context.actor.membershipId},
        confirmed_at = now(),
        version = version + 1,
        updated_at = now()
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and id = ${input.depositId}
      and version = ${input.expectedVersion}
    returning version
  `);
  if (!updated[0]) throw new AppError('CONFLICT', 'The bank deposit became stale');
  return {
    depositId: deposit.id,
    state: 'CONFIRMED' as const,
    confirmedAmount: confirmed.toString(),
    variance,
    version: Number(updated[0].version),
  };
}

export async function getCashStationSummaryInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  options: {
    capabilities?: {
      prepareHandover: boolean;
      acceptHandover: boolean;
      resolveHandover: boolean;
    };
  } = {},
) {
  const rows = await transaction.execute<{
    id: string;
    collection_reference: string;
    amount: string;
    state: string;
    current_location_id: string;
    recorded_at: string | Date;
    received_at: string | Date | null;
    allocated_amount: string;
    confirmed_amount: string;
    available_at_station: string;
    collected_but_unbanked: string;
    pending_bank_confirmation: string;
    custody_state: string;
    total_available_at_station: string | null;
    total_collected_but_unbanked: string | null;
    total_pending_bank_confirmation: string | null;
  }>(sql`
    with collection_custody as (
      select c.id, c.collection_reference, c.amount, c.state, c.current_location_id,
             c.recorded_at, c.received_at,
             coalesce(sum(a.amount) filter (where d.state <> 'REVERSED'), 0)::numeric as allocated_amount,
             coalesce(sum(a.amount) filter (where d.state = 'CONFIRMED'), 0)::numeric as confirmed_amount
      from app.cash_collections c
      left join app.bank_deposit_allocations a
        on a.tenant_id = c.tenant_id and a.station_id = c.station_id and a.collection_id = c.id
      left join app.bank_deposits d
        on d.tenant_id = a.tenant_id and d.station_id = a.station_id and d.id = a.deposit_id
      where c.tenant_id = ${context.tenantId}
        and c.station_id = ${context.stationId}
        and c.state <> 'REVERSED'
      group by c.id, c.collection_reference, c.amount, c.state, c.current_location_id,
               c.recorded_at, c.received_at
    ), calculated as (
      select collection_custody.*,
        (amount - allocated_amount)::text as available_at_station,
        (amount - confirmed_amount)::text as collected_but_unbanked,
        (allocated_amount - confirmed_amount)::text as pending_bank_confirmation,
        case when confirmed_amount = amount then 'BANKED'
          when allocated_amount = amount then 'IN_TRANSIT'
          when allocated_amount > 0 then 'PARTIALLY_DEPOSITED'
          when state = 'RECEIVED' then 'RECEIVED'
          else 'AT_STATION' end as custody_state
      from collection_custody
    )
    select id, collection_reference, amount::text, state, current_location_id,
           recorded_at, received_at, allocated_amount::text, confirmed_amount::text,
           available_at_station, collected_but_unbanked, pending_bank_confirmation, custody_state,
           sum(available_at_station::numeric) over ()::text as total_available_at_station,
           sum(collected_but_unbanked::numeric) over ()::text as total_collected_but_unbanked,
           sum(pending_bank_confirmation::numeric) over ()::text as total_pending_bank_confirmation
    from calculated
    order by recorded_at, id
  `);

  const locationRows = await transaction.execute<{
    id: string;
    code: string;
    name: string;
    location_type: string;
  }>(sql`
    select id, code, name, location_type
    from app.cash_locations
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and status = 'ACTIVE'
    order by name, id
  `);

  const handoverRows = await transaction.execute<{
    id: string;
    from_location_id: string;
    from_location_name: string;
    to_location_id: string;
    to_location_name: string;
    expected_amount: string;
    counted_amount: string | null;
    variance: string | null;
    state: string;
    delivered_by: string;
    received_by: string | null;
    dispute_reason: string | null;
    submitted_at: string | Date | null;
    accepted_at: string | Date | null;
    created_at: string | Date;
    version: number | string;
  }>(sql`
    select h.id,
           h.from_location_id,
           from_location.name as from_location_name,
           h.to_location_id,
           to_location.name as to_location_name,
           h.expected_amount::text,
           h.counted_amount::text,
           h.variance::text,
           h.state,
           h.delivered_by,
           h.received_by,
           h.dispute_reason,
           h.submitted_at,
           h.accepted_at,
           h.created_at,
           h.version
    from app.cash_handovers h
    join app.cash_locations from_location
      on from_location.tenant_id = h.tenant_id
     and from_location.station_id = h.station_id
     and from_location.id = h.from_location_id
    join app.cash_locations to_location
      on to_location.tenant_id = h.tenant_id
     and to_location.station_id = h.station_id
     and to_location.id = h.to_location_id
    where h.tenant_id = ${context.tenantId}
      and h.station_id = ${context.stationId}
    order by h.created_at desc, h.id desc
  `);

  const collections = rows.map((row) => {
    return {
      collectionId: row.id,
      collectionReference: row.collection_reference,
      amount: row.amount,
      allocatedAmount: row.allocated_amount,
      confirmedAmount: row.confirmed_amount,
      availableAtStation: row.available_at_station,
      collectedButUnbanked: row.collected_but_unbanked,
      pendingBankConfirmation: row.pending_bank_confirmation,
      state: row.state,
      custodyState: row.custody_state,
      currentLocationId: row.current_location_id,
      recordedAt: new Date(row.recorded_at).toISOString(),
      receivedAt: row.received_at ? new Date(row.received_at).toISOString() : null,
    };
  });

  return {
    stationId: context.stationId,
    currency: 'USD',
    totals: {
      availableAtStation: rows[0]?.total_available_at_station ?? '0',
      collectedButUnbanked: rows[0]?.total_collected_but_unbanked ?? '0',
      pendingBankConfirmation: rows[0]?.total_pending_bank_confirmation ?? '0',
    },
    locations: locationRows.map((row) => ({
      locationId: row.id,
      code: row.code,
      name: row.name,
      locationType: row.location_type,
    })),
    handovers: handoverRows.map((row) => ({
      handoverId: row.id,
      fromLocationId: row.from_location_id,
      fromLocationName: row.from_location_name,
      toLocationId: row.to_location_id,
      toLocationName: row.to_location_name,
      expectedAmount: row.expected_amount,
      countedAmount: row.counted_amount,
      variance: row.variance,
      state: row.state,
      deliveredBy: row.delivered_by,
      receivedBy: row.received_by,
      disputeReason: row.dispute_reason,
      submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
      acceptedAt: row.accepted_at ? new Date(row.accepted_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      version: Number(row.version),
    })),
    handoverCapabilities: options.capabilities ?? {
      prepareHandover: false,
      acceptHandover: false,
      resolveHandover: false,
    },
    collections,
  };
}
