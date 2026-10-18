import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import { ExactDecimal } from '../../platform/domain/primitives';
import {
  calculateBankDepositAmount,
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
  // No row lock: the runtime role may only SELECT/INSERT bank accounts (migration 0006),
  // and `for update` needs UPDATE, so it failed every deposit with a permission error.
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
  options: Readonly<{
    includeDepositDetails?: boolean;
    capabilities?: Readonly<{
      viewDeposits: boolean;
      recordCollection: boolean;
      receiveCollection: boolean;
      recordDeposit: boolean;
      confirmDeposit: boolean;
    }>;
  }> = {},
) {
  type RowsRow = {
    id: string;
    collection_reference: string;
    source_location_id: string;
    amount: string;
    state: string;
    current_location_id: string;
    version: number | string;
    recorded_at: string | Date;
    received_at: string | Date | null;
    allocated_amount: string;
    confirmed_amount: string;
  };
  type LocationsRow = {
    id: string;
    code: string;
    name: string;
    location_type: string;
  };
  type ReconciliationSourcesRow = {
    reconciliation_id: string;
    business_date: string;
    counted_cash: string;
    allocated_cash: string;
  };
  type DepositRowsRow = {
    id: string;
    deposit_reference: string;
    amount: string;
    state: string;
    version: number | string;
    source_location_id: string;
    bank_account_id: string;
    bank_account_name: string;
    confirmed_amount: string | null;
    confirmation_variance: string | null;
    bank_reference: string | null;
    deposited_at: string | Date;
  };
  type BankAccountsRow = {
    id: string;
    name: string;
    bank_name: string;
    account_reference_masked: string;
  };
  const rowsQuery = sql`
    select c.id, c.collection_reference, c.source_location_id, c.amount::text, c.state,
           c.current_location_id, c.version,
           c.recorded_at, c.received_at,
           coalesce(sum(case when d.state <> 'REVERSED' then a.amount else 0 end), 0)::text as allocated_amount,
           coalesce(sum(case when d.state = 'CONFIRMED' then a.amount else 0 end), 0)::text as confirmed_amount
    from app.cash_collections c
    left join app.bank_deposit_allocations a
      on a.tenant_id = c.tenant_id and a.station_id = c.station_id and a.collection_id = c.id
    left join app.bank_deposits d
      on d.tenant_id = a.tenant_id and d.station_id = a.station_id and d.id = a.deposit_id
    where c.tenant_id = ${context.tenantId}
      and c.station_id = ${context.stationId}
      and c.state <> 'REVERSED'
    group by c.id, c.collection_reference, c.source_location_id, c.amount, c.state,
             c.current_location_id, c.version, c.recorded_at, c.received_at
    order by c.recorded_at, c.id
  `;
  const locationsQuery = sql`
    select id, code, name, location_type
    from app.cash_locations
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and status = 'ACTIVE'
    order by code, id
  `;
  const reconciliationSourcesQuery = sql`
    select r.id as reconciliation_id,
           bd.business_date,
           cd.counted_cash::text as counted_cash,
           coalesce(sum(a.amount), 0)::text as allocated_cash
    from app.reconciliations r
    join app.station_business_days bd
      on bd.tenant_id = r.tenant_id
     and bd.station_id = r.station_id
     and bd.id = r.business_day_id
    join app.reconciliation_cash_declarations cd
      on cd.tenant_id = r.tenant_id
     and cd.station_id = r.station_id
     and cd.reconciliation_id = r.id
    left join app.cash_collection_allocations a
      on a.tenant_id = r.tenant_id
     and a.station_id = r.station_id
     and a.reconciliation_id = r.id
    where r.tenant_id = ${context.tenantId}
      and r.station_id = ${context.stationId}
      and r.state in ('APPROVED', 'POSTED', 'LOCKED')
    group by r.id, bd.business_date, cd.counted_cash
    having cd.counted_cash - coalesce(sum(a.amount), 0) > 0
    order by bd.business_date desc, r.id
  `;
  const depositRowsQuery = options.includeDepositDetails
    ? sql`
        select d.id,
               d.deposit_reference,
               d.amount::text,
               d.state,
               d.version,
               d.source_location_id,
               d.bank_account_id,
               ba.name as bank_account_name,
               d.confirmed_amount::text,
               d.confirmation_variance::text,
               d.bank_reference,
               d.deposited_at
        from app.bank_deposits d
        join app.bank_accounts ba
          on ba.tenant_id = d.tenant_id
         and ba.id = d.bank_account_id
        where d.tenant_id = ${context.tenantId}
          and d.station_id = ${context.stationId}
          and d.state <> 'REVERSED'
        order by d.deposited_at desc, d.id desc
      `
    : sql`select null as unavailable where false`;
  const bankAccountsQuery = options.includeDepositDetails
    ? sql`
        select id, name, bank_name, account_reference_masked
        from app.bank_accounts
        where tenant_id = ${context.tenantId}
          and legal_entity_id = ${context.legalEntityId}
          and status = 'ACTIVE'
          and currency = 'USD'
        order by name, id
      `
    : sql`select null as unavailable where false`;
  const sections = await transaction.execute<{
    rows: RowsRow[];
    locations: LocationsRow[];
    reconciliationSources: ReconciliationSourcesRow[];
    depositRows: DepositRowsRow[];
    bankAccounts: BankAccountsRow[];
  }>(sql`
    with rows_rows as (${rowsQuery}),
locations_rows as (${locationsQuery}),
reconciliationSources_rows as (${reconciliationSourcesQuery}),
depositRows_rows as (${depositRowsQuery}),
bankAccounts_rows as (${bankAccountsQuery})
    select coalesce((select json_agg(rows_rows) from rows_rows), '[]'::json) as "rows",
coalesce((select json_agg(locations_rows) from locations_rows), '[]'::json) as "locations",
coalesce((select json_agg(reconciliationSources_rows) from reconciliationSources_rows), '[]'::json) as "reconciliationSources",
coalesce((select json_agg(depositRows_rows) from depositRows_rows), '[]'::json) as "depositRows",
coalesce((select json_agg(bankAccounts_rows) from bankAccounts_rows), '[]'::json) as "bankAccounts"
  `);
  const snapshot = sections[0];
  if (!snapshot) throw new AppError('INVARIANT_VIOLATION', 'Cash summary was not returned');
  const { rows, locations, reconciliationSources, depositRows, bankAccounts } = snapshot;

  let availableAtStation = new ExactDecimal('0');
  let collectedButUnbanked = new ExactDecimal('0');
  let pendingBankConfirmation = new ExactDecimal('0');
  const collections = rows.map((row) => {
    const amount = decimal(row.amount);
    const allocated = decimal(row.allocated_amount);
    const confirmed = decimal(row.confirmed_amount);
    const available = decimal(remainingCashAmount(row.amount, row.allocated_amount));
    const unbanked = decimal(remainingCashAmount(row.amount, row.confirmed_amount));
    const pending = allocated.subtract(confirmed);
    availableAtStation = availableAtStation.add(available);
    collectedButUnbanked = collectedButUnbanked.add(unbanked);
    pendingBankConfirmation = pendingBankConfirmation.add(pending);
    const custodyState = confirmed.equals(amount)
      ? 'BANKED'
      : allocated.equals(amount)
        ? 'IN_TRANSIT'
        : allocated.value.gt(0)
          ? 'PARTIALLY_DEPOSITED'
          : row.state === 'RECEIVED'
            ? 'RECEIVED'
            : 'AT_STATION';
    return {
      collectionId: row.id,
      collectionReference: row.collection_reference,
      amount: amount.toString(),
      allocatedAmount: allocated.toString(),
      confirmedAmount: confirmed.toString(),
      availableAtStation: available.toString(),
      collectedButUnbanked: unbanked.toString(),
      pendingBankConfirmation: pending.toString(),
      state: row.state,
      custodyState,
      sourceLocationId: row.source_location_id,
      currentLocationId: row.current_location_id,
      version: Number(row.version),
      recordedAt: new Date(row.recorded_at).toISOString(),
      receivedAt: row.received_at ? new Date(row.received_at).toISOString() : null,
    };
  });

  const availableSources = reconciliationSources.map((row) => ({
    reconciliationId: row.reconciliation_id,
    businessDate: row.business_date,
    countedCash: decimal(row.counted_cash).toString(),
    allocatedCash: decimal(row.allocated_cash).toString(),
    availableCash: remainingCashAmount(row.counted_cash, row.allocated_cash),
  }));

  const deposits = depositRows.map((row) => ({
    depositId: row.id,
    depositReference: row.deposit_reference,
    amount: decimal(row.amount).toString(),
    state: row.state,
    version: Number(row.version),
    sourceLocationId: row.source_location_id,
    bankAccountId: row.bank_account_id,
    bankAccountName: row.bank_account_name,
    confirmedAmount: row.confirmed_amount ? decimal(row.confirmed_amount).toString() : null,
    confirmationVariance: row.confirmation_variance
      ? decimal(row.confirmation_variance).toString()
      : null,
    bankReference: row.bank_reference,
    depositedAt: new Date(row.deposited_at).toISOString(),
  }));

  return {
    stationId: context.stationId,
    currency: 'USD',
    totals: {
      availableAtStation: availableAtStation.toString(),
      collectedButUnbanked: collectedButUnbanked.toString(),
      pendingBankConfirmation: pendingBankConfirmation.toString(),
    },
    collections,
    locations: locations.map((row) => ({
      locationId: row.id,
      code: row.code,
      name: row.name,
      locationType: row.location_type,
    })),
    reconciliationSources: availableSources,
    bankAccounts: bankAccounts.map((row) => ({
      bankAccountId: row.id,
      name: row.name,
      bankName: row.bank_name,
      accountReferenceMasked: row.account_reference_masked,
    })),
    deposits,
    capabilities: options.capabilities ?? {
      viewDeposits: false,
      recordCollection: false,
      receiveCollection: false,
      recordDeposit: false,
      confirmDeposit: false,
    },
  };
}
