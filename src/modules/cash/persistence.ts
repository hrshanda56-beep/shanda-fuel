import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import { ExactDecimal } from '../../platform/domain/primitives';
import {
  calculateBankDepositAmount,
  calculateCashCollectionAmount,
  remainingCashAmount,
  submitCashHandover,
  transitionCashHandover,
  type BankDepositAllocation,
  type CashHandoverState,
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
  if (!rows[0]) throw new AppError('NOT_FOUND', 'That cash location is no longer available');
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
        'Each shift report can be added to a collection only once',
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
        'Only approved shift reports that include cash can be collected',
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
    throw new AppError(
      'CONFLICT',
      'Only cash that has been recorded and not yet received can be received',
    );
  }
  if (Number(collection.version) !== input.expectedVersion) {
    throw new AppError(
      'CONFLICT',
      'Someone else changed this cash collection. Refresh and try again.',
      {
        expectedVersion: input.expectedVersion,
        actualVersion: Number(collection.version),
      },
    );
  }
  if (collection.current_location_id === input.targetLocationId) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Choose a different location from where the cash is now',
    );
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
  if (!updated[0])
    throw new AppError(
      'CONFLICT',
      'Someone else changed this cash collection. Refresh and try again.',
    );
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
  if (!bankRows[0]) throw new AppError('NOT_FOUND', 'That bank account is no longer available');

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
    throw new AppError('CONFLICT', 'This bank deposit has already been confirmed');
  }
  if (Number(deposit.version) !== input.expectedVersion) {
    throw new AppError(
      'CONFLICT',
      'Someone else changed this bank deposit. Refresh and try again.',
      {
        expectedVersion: input.expectedVersion,
        actualVersion: Number(deposit.version),
      },
    );
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
  if (!updated[0])
    throw new AppError(
      'CONFLICT',
      'Someone else changed this bank deposit. Refresh and try again.',
    );
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
      submitHandover: boolean;
      acceptHandover: boolean;
      resolveHandover: boolean;
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
    business_date: string;
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
    expected_confirmation_at: string | Date | null;
    confirmed_at: string | Date | null;
  };
  type DepositLinkRow = {
    collection_id: string;
    collection_reference: string;
    deposit_id: string;
    deposit_reference: string;
    amount: string;
    state: string;
    deposited_at: string | Date;
  };
  type ShiftLinkRow = {
    collection_id: string;
    reconciliation_id: string;
    business_date: string;
    amount: string;
  };
  type HandoverSummaryRow = {
    id: string;
    from_location_id: string;
    to_location_id: string;
    expected_amount: string;
    counted_amount: string | null;
    variance: string | null;
    state: string;
    version: number | string;
    dispute_reason: string | null;
    resolution_note: string | null;
    delivered_by: string;
    delivered_by_name: string;
    received_by_name: string | null;
    submitted_at: string | Date | null;
    accepted_at: string | Date | null;
    resolved_at: string | Date | null;
  };
  type BankAccountsRow = {
    id: string;
    name: string;
    bank_name: string;
    account_reference_masked: string;
  };
  const rowsQuery = sql`
    select c.id, c.collection_reference, c.source_location_id, c.amount::text, c.state,
           c.current_location_id, c.version, c.business_date,
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
             c.current_location_id, c.version, c.business_date, c.recorded_at, c.received_at
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
               d.deposited_at,
               d.expected_confirmation_at,
               d.confirmed_at
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
  // Which deposits each collection went into (and so what each deposit holds). Reversed
  // deposits are kept so the history stays complete; the UI labels them.
  const depositLinksQuery = options.includeDepositDetails
    ? sql`
        select a.collection_id,
               c.collection_reference,
               a.deposit_id,
               d.deposit_reference,
               a.amount::text,
               d.state,
               d.deposited_at
        from app.bank_deposit_allocations a
        join app.bank_deposits d
          on d.tenant_id = a.tenant_id and d.station_id = a.station_id and d.id = a.deposit_id
        join app.cash_collections c
          on c.tenant_id = a.tenant_id and c.station_id = a.station_id and c.id = a.collection_id
        where a.tenant_id = ${context.tenantId}
          and a.station_id = ${context.stationId}
        order by d.deposited_at, a.id
      `
    : sql`select null as unavailable where false`;
  const shiftLinksQuery = sql`
    select a.collection_id, a.reconciliation_id, bd.business_date, a.amount::text
    from app.cash_collection_allocations a
    join app.reconciliations r
      on r.tenant_id = a.tenant_id and r.station_id = a.station_id and r.id = a.reconciliation_id
    join app.station_business_days bd
      on bd.tenant_id = r.tenant_id and bd.station_id = r.station_id and bd.id = r.business_day_id
    where a.tenant_id = ${context.tenantId}
      and a.station_id = ${context.stationId}
    order by bd.business_date, a.id
  `;
  const handoversQuery = sql`
    select h.id, h.from_location_id, h.to_location_id,
           h.expected_amount::text, h.counted_amount::text, h.variance::text,
           h.state, h.version, h.dispute_reason, h.resolution_note,
           h.delivered_by, coalesce(du.name, 'Unknown') as delivered_by_name,
           coalesce(ru.name, null) as received_by_name,
           h.submitted_at, h.accepted_at, h.resolved_at
    from app.cash_handovers h
    left join app.memberships dm on dm.tenant_id = h.tenant_id and dm.id = h.delivered_by
    left join app.users du on du.id = dm.identity_id
    left join app.memberships rm on rm.tenant_id = h.tenant_id and rm.id = coalesce(h.resolved_by, h.received_by)
    left join app.users ru on ru.id = rm.identity_id
    where h.tenant_id = ${context.tenantId}
      and h.station_id = ${context.stationId}
      and (h.state in ('SUBMITTED', 'DISPUTED') or h.updated_at > now() - interval '14 days')
    order by h.created_at desc, h.id desc
    limit 50
  `;
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
    depositLinks: DepositLinkRow[];
    shiftLinks: ShiftLinkRow[];
    bankAccounts: BankAccountsRow[];
    handovers: HandoverSummaryRow[];
  }>(sql`
    with rows_rows as (${rowsQuery}),
locations_rows as (${locationsQuery}),
reconciliationSources_rows as (${reconciliationSourcesQuery}),
depositRows_rows as (${depositRowsQuery}),
depositLinks_rows as (${depositLinksQuery}),
shiftLinks_rows as (${shiftLinksQuery}),
bankAccounts_rows as (${bankAccountsQuery}),
handovers_rows as (${handoversQuery})
    select coalesce((select json_agg(rows_rows) from rows_rows), '[]'::json) as "rows",
coalesce((select json_agg(locations_rows) from locations_rows), '[]'::json) as "locations",
coalesce((select json_agg(reconciliationSources_rows) from reconciliationSources_rows), '[]'::json) as "reconciliationSources",
coalesce((select json_agg(depositRows_rows) from depositRows_rows), '[]'::json) as "depositRows",
coalesce((select json_agg(depositLinks_rows) from depositLinks_rows), '[]'::json) as "depositLinks",
coalesce((select json_agg(shiftLinks_rows) from shiftLinks_rows), '[]'::json) as "shiftLinks",
coalesce((select json_agg(bankAccounts_rows) from bankAccounts_rows), '[]'::json) as "bankAccounts",
coalesce((select json_agg(handovers_rows) from handovers_rows), '[]'::json) as "handovers"
  `);
  const snapshot = sections[0];
  if (!snapshot) throw new AppError('INVARIANT_VIOLATION', 'Cash summary was not returned');
  const {
    rows,
    locations,
    reconciliationSources,
    depositRows,
    depositLinks,
    shiftLinks,
    bankAccounts,
    handovers,
  } = snapshot;
  const iso = (value: string | Date | null) => (value ? new Date(value).toISOString() : null);

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
      businessDate: row.business_date,
      recordedAt: new Date(row.recorded_at).toISOString(),
      receivedAt: iso(row.received_at),
      deposits: depositLinks
        .filter((link) => link.collection_id === row.id)
        .map((link) => ({
          depositId: link.deposit_id,
          depositReference: link.deposit_reference,
          amount: decimal(link.amount).toString(),
          state: link.state,
          depositedAt: new Date(link.deposited_at).toISOString(),
        })),
      shiftReports: shiftLinks
        .filter((link) => link.collection_id === row.id)
        .map((link) => ({
          reconciliationId: link.reconciliation_id,
          businessDate: link.business_date,
          amount: decimal(link.amount).toString(),
        })),
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
    expectedConfirmationAt: iso(row.expected_confirmation_at),
    confirmedAt: iso(row.confirmed_at),
    collections: depositLinks
      .filter((link) => link.deposit_id === row.id)
      .map((link) => ({
        collectionId: link.collection_id,
        collectionReference: link.collection_reference,
        amount: decimal(link.amount).toString(),
      })),
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
    handovers: handovers.map((row) => ({
      handoverId: row.id,
      fromLocationId: row.from_location_id,
      toLocationId: row.to_location_id,
      expectedAmount: decimal(row.expected_amount).toString(),
      countedAmount: row.counted_amount ? decimal(row.counted_amount).toString() : null,
      variance: row.variance ? decimal(row.variance).toString() : null,
      state: row.state,
      version: Number(row.version),
      reason: row.dispute_reason,
      resolutionNote: row.resolution_note,
      deliveredByMembershipId: row.delivered_by,
      deliveredByName: row.delivered_by_name,
      receivedByName: row.received_by_name,
      submittedAt: iso(row.submitted_at),
      acceptedAt: iso(row.accepted_at),
      resolvedAt: iso(row.resolved_at),
    })),
    currentMembershipId: context.actor.membershipId,
    capabilities: options.capabilities ?? {
      viewDeposits: false,
      recordCollection: false,
      receiveCollection: false,
      recordDeposit: false,
      confirmDeposit: false,
      submitHandover: false,
      acceptHandover: false,
      resolveHandover: false,
    },
  };
}

type HandoverRow = {
  id: string;
  from_location_id: string;
  to_location_id: string;
  counted_amount: string | null;
  state: string;
  delivered_by: string;
  version: number | string;
};

async function loadHandover(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  handoverId: string,
): Promise<HandoverRow> {
  const rows = await transaction.execute<HandoverRow>(sql`
    select id, from_location_id, to_location_id, counted_amount::text as counted_amount,
           state, delivered_by, version
    from app.cash_handovers
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and id = ${handoverId}
    for update
  `);
  const handover = rows[0];
  if (!handover) throw new AppError('NOT_FOUND', 'The cash handover was not found');
  return handover;
}

function assertHandoverVersion(handover: HandoverRow, expectedVersion: number): void {
  if (Number(handover.version) !== expectedVersion) {
    throw new AppError(
      'CONFLICT',
      'Someone else changed this cash handover. Refresh and try again.',
      { expectedVersion, actualVersion: Number(handover.version) },
    );
  }
}

async function moveHandoverCash(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  handover: HandoverRow,
): Promise<void> {
  if (handover.counted_amount === null || decimal(handover.counted_amount).value.lte(0)) return;
  const dates = await transaction.execute<{ business_date: string }>(sql`
    select to_char((now() at time zone s.timezone)::date, 'YYYY-MM-DD') as business_date
    from app.stations s
    where s.tenant_id = ${context.tenantId} and s.id = ${context.stationId}
  `);
  await transaction.execute(sql`
    insert into app.cash_movements (
      id, tenant_id, station_id, movement_type, amount, currency,
      from_location_id, to_location_id, source_type, source_id,
      business_date, effective_at, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.stationId}, 'TRANSFER', ${handover.counted_amount}, 'USD',
      ${handover.from_location_id}, ${handover.to_location_id}, 'CASH_HANDOVER',
      ${handover.id}, ${dates[0]!.business_date}, now(), ${context.actor.membershipId}
    )
  `);
}

/**
 * One person hands cash to another (attendant to supervisor, supervisor to the owner's
 * collector). A count that matches what was expected waits to be accepted; a count that does
 * not match goes straight to review with the reason the person gave.
 */
export async function submitCashHandoverInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: {
    fromLocationId: string;
    toLocationId: string;
    expectedAmount: string;
    countedAmount: string;
    reason?: string;
  },
) {
  if (input.fromLocationId === input.toLocationId) {
    throw new AppError('VALIDATION_FAILED', 'Choose a different place to hand the cash to');
  }
  await assertActiveCashLocation(transaction, context, input.fromLocationId);
  await assertActiveCashLocation(transaction, context, input.toLocationId);
  const outcome = submitCashHandover({
    expectedAmount: input.expectedAmount,
    countedAmount: input.countedAmount,
  });
  const reason = input.reason?.trim() || null;
  if (outcome.state === 'DISPUTED' && !reason) {
    throw new AppError(
      'VALIDATION_FAILED',
      'The cash counted is different from the cash expected. Say why.',
    );
  }
  const id = randomUUID();
  await transaction.execute(sql`
    insert into app.cash_handovers (
      id, tenant_id, station_id, from_location_id, to_location_id,
      expected_amount, counted_amount, variance, state, delivered_by,
      dispute_reason, submitted_at
    ) values (
      ${id}, ${context.tenantId}, ${context.stationId}, ${input.fromLocationId}, ${input.toLocationId},
      ${outcome.expectedAmount}, ${outcome.countedAmount}, ${outcome.variance}, ${outcome.state},
      ${context.actor.membershipId}, ${reason}, now()
    )
  `);
  return {
    handoverId: id,
    state: outcome.state,
    variance: outcome.variance ?? '0',
    version: 0,
  };
}

/** The receiver confirms the cash arrived. Nobody can accept cash they handed over themselves. */
export async function acceptCashHandoverInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: { handoverId: string; expectedVersion: number },
) {
  const handover = await loadHandover(transaction, context, input.handoverId);
  assertHandoverVersion(handover, input.expectedVersion);
  if (handover.delivered_by === context.actor.membershipId) {
    throw new AppError('FORBIDDEN', 'You cannot accept cash that you handed over yourself');
  }
  const next = transitionCashHandover(handover.state as CashHandoverState, 'AcceptCashHandover');
  await moveHandoverCash(transaction, context, handover);
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.cash_handovers
    set state = ${next},
        received_by = ${context.actor.membershipId},
        accepted_at = now(),
        version = version + 1,
        updated_at = now()
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and id = ${input.handoverId}
      and version = ${input.expectedVersion}
    returning version
  `);
  return { handoverId: handover.id, state: next, version: Number(updated[0]!.version) };
}

/** A person with authority settles a handover that did not add up. The cash that was counted moves. */
export async function resolveCashHandoverInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: { handoverId: string; expectedVersion: number; resolutionNote: string },
) {
  const handover = await loadHandover(transaction, context, input.handoverId);
  assertHandoverVersion(handover, input.expectedVersion);
  if (handover.delivered_by === context.actor.membershipId) {
    throw new AppError('FORBIDDEN', 'You cannot settle a handover that you made yourself');
  }
  const next = transitionCashHandover(handover.state as CashHandoverState, 'ResolveCashHandover');
  await moveHandoverCash(transaction, context, handover);
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.cash_handovers
    set state = ${next},
        received_by = ${context.actor.membershipId},
        resolved_by = ${context.actor.membershipId},
        resolved_at = now(),
        resolution_note = ${input.resolutionNote},
        version = version + 1,
        updated_at = now()
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and id = ${input.handoverId}
      and version = ${input.expectedVersion}
    returning version
  `);
  return { handoverId: handover.id, state: next, version: Number(updated[0]!.version) };
}

/** Only the person who handed the cash over, or someone allowed to accept it, can withdraw it. */
export async function cancelCashHandoverInTransaction(
  transaction: ForecourtTransaction,
  context: CashCommandContext,
  input: { handoverId: string; expectedVersion: number; canActForOthers: boolean },
) {
  const handover = await loadHandover(transaction, context, input.handoverId);
  assertHandoverVersion(handover, input.expectedVersion);
  if (handover.delivered_by !== context.actor.membershipId && !input.canActForOthers) {
    throw new AppError('FORBIDDEN', 'Only the person who handed over the cash can withdraw it');
  }
  const next = transitionCashHandover(handover.state as CashHandoverState, 'CancelCashHandover');
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.cash_handovers
    set state = ${next}, version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId}
      and station_id = ${context.stationId}
      and id = ${input.handoverId}
      and version = ${input.expectedVersion}
    returning version
  `);
  return { handoverId: handover.id, state: next, version: Number(updated[0]!.version) };
}
