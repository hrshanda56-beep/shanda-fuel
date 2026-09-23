import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { legalEntities, memberships, stations, tenants } from './a1';
import { reconciliations } from './a3';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });

export const cashLocations = appSchema.table(
  'cash_locations',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    locationType: text('location_type').notNull(),
    currency: text('currency').notNull().default('USD'),
    status: text('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(0),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('cash_locations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('cash_locations_tenant_station_code_uidx').on(
      table.tenantId,
      table.stationId,
      table.code,
    ),
    index('cash_locations_tenant_station_status_idx').on(
      table.tenantId,
      table.stationId,
      table.status,
    ),
    check(
      'cash_locations_type_ck',
      sql`${table.locationType} in ('STATION_TILL','STATION_SAFE','TRANSIT','COLLECTOR')`,
    ),
    check('cash_locations_currency_ck', sql`${table.currency} = 'USD'`),
    check('cash_locations_status_ck', sql`${table.status} in ('ACTIVE','INACTIVE')`),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'cash_locations_tenant_station_fk',
    }),
  ],
);

const cashLocationScope = (
  table: { tenantId: AnyPgColumn; stationId: AnyPgColumn; locationId: AnyPgColumn },
  name: string,
) =>
  foreignKey({
    columns: [table.tenantId, table.stationId, table.locationId],
    foreignColumns: [cashLocations.tenantId, cashLocations.stationId, cashLocations.id],
    name,
  });

const reconciliationScope = (
  table: { tenantId: AnyPgColumn; stationId: AnyPgColumn; reconciliationId: AnyPgColumn },
  name: string,
) =>
  foreignKey({
    columns: [table.tenantId, table.stationId, table.reconciliationId],
    foreignColumns: [reconciliations.tenantId, reconciliations.stationId, reconciliations.id],
    name,
  });

const cashCollectionScope = (
  table: { tenantId: AnyPgColumn; stationId: AnyPgColumn; collectionId: AnyPgColumn },
  name: string,
) =>
  foreignKey({
    columns: [table.tenantId, table.stationId, table.collectionId],
    foreignColumns: [cashCollections.tenantId, cashCollections.stationId, cashCollections.id],
    name,
  });

export const cashCollections = appSchema.table(
  'cash_collections',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    collectionReference: text('collection_reference').notNull(),
    sourceLocationId: uuid('source_location_id').notNull(),
    currentLocationId: uuid('current_location_id').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    businessDate: text('business_date').notNull(),
    state: text('state').notNull().default('RECORDED'),
    recordedBy: uuid('recorded_by').notNull(),
    receivedBy: uuid('received_by'),
    recordedAt: utcTimestamp('recorded_at').notNull().defaultNow(),
    receivedAt: utcTimestamp('received_at'),
    version: integer('version').notNull().default(0),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('cash_collections_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('cash_collections_tenant_station_reference_uidx').on(
      table.tenantId,
      table.stationId,
      table.collectionReference,
    ),
    index('cash_collections_tenant_station_state_idx').on(
      table.tenantId,
      table.stationId,
      table.state,
    ),
    check('cash_collections_amount_ck', sql`${table.amount} > 0`),
    check('cash_collections_currency_ck', sql`${table.currency} = 'USD'`),
    check('cash_collections_state_ck', sql`${table.state} in ('RECORDED','RECEIVED','REVERSED')`),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'cash_collections_tenant_station_fk',
    }),
    cashLocationScope(
      { tenantId: table.tenantId, stationId: table.stationId, locationId: table.sourceLocationId },
      'cash_collections_source_location_fk',
    ),
    cashLocationScope(
      { tenantId: table.tenantId, stationId: table.stationId, locationId: table.currentLocationId },
      'cash_collections_current_location_fk',
    ),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'cash_collections_recorded_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.receivedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'cash_collections_received_by_fk',
    }),
  ],
);

export const cashCollectionAllocations = appSchema.table(
  'cash_collection_allocations',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    collectionId: uuid('collection_id').notNull(),
    reconciliationId: uuid('reconciliation_id').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    allocatedBy: uuid('allocated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('cash_collection_allocations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('cash_collection_allocations_collection_reconciliation_uidx').on(
      table.tenantId,
      table.stationId,
      table.collectionId,
      table.reconciliationId,
    ),
    index('cash_collection_allocations_reconciliation_idx').on(
      table.tenantId,
      table.stationId,
      table.reconciliationId,
    ),
    check('cash_collection_allocations_amount_ck', sql`${table.amount} > 0`),
    check('cash_collection_allocations_currency_ck', sql`${table.currency} = 'USD'`),
    cashCollectionScope(table, 'cash_collection_allocations_collection_fk'),
    reconciliationScope(table, 'cash_collection_allocations_reconciliation_fk'),
    foreignKey({
      columns: [table.tenantId, table.allocatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'cash_collection_allocations_allocated_by_fk',
    }),
  ],
);

export const cashMovements = appSchema.table(
  'cash_movements',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    movementType: text('movement_type').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    fromLocationId: uuid('from_location_id'),
    toLocationId: uuid('to_location_id'),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    businessDate: text('business_date').notNull(),
    effectiveAt: utcTimestamp('effective_at').notNull(),
    reason: text('reason'),
    reversalOfId: uuid('reversal_of_id'),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    postedAt: utcTimestamp('posted_at').notNull().defaultNow(),
  },
  (table) => [
    unique('cash_movements_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('cash_movements_source_uidx').on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
      table.movementType,
    ),
    index('cash_movements_tenant_station_effective_idx').on(
      table.tenantId,
      table.stationId,
      table.effectiveAt,
    ),
    check(
      'cash_movements_type_ck',
      sql`${table.movementType} in ('RECEIPT','DISBURSEMENT','TRANSFER','ADJUSTMENT_IN','ADJUSTMENT_OUT')`,
    ),
    check('cash_movements_amount_ck', sql`${table.amount} > 0`),
    check('cash_movements_currency_ck', sql`${table.currency} = 'USD'`),
    check(
      'cash_movements_direction_ck',
      sql`(
        (${table.movementType} = 'RECEIPT' and ${table.fromLocationId} is null and ${table.toLocationId} is not null)
        or (${table.movementType} = 'DISBURSEMENT' and ${table.fromLocationId} is not null and ${table.toLocationId} is null)
        or (${table.movementType} = 'TRANSFER' and ${table.fromLocationId} is not null and ${table.toLocationId} is not null and ${table.fromLocationId} <> ${table.toLocationId})
        or (${table.movementType} = 'ADJUSTMENT_IN' and ${table.fromLocationId} is null and ${table.toLocationId} is not null)
        or (${table.movementType} = 'ADJUSTMENT_OUT' and ${table.fromLocationId} is not null and ${table.toLocationId} is null)
      )`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'cash_movements_tenant_station_fk',
    }),
    cashLocationScope(
      { tenantId: table.tenantId, stationId: table.stationId, locationId: table.fromLocationId },
      'cash_movements_from_location_fk',
    ),
    cashLocationScope(
      { tenantId: table.tenantId, stationId: table.stationId, locationId: table.toLocationId },
      'cash_movements_to_location_fk',
    ),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'cash_movements_actor_membership_fk',
    }),
  ],
);

export const cashCounts = appSchema.table(
  'cash_counts',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    locationId: uuid('location_id').notNull(),
    businessDate: text('business_date').notNull(),
    countedAt: utcTimestamp('counted_at').notNull(),
    expectedAmount: numeric('expected_amount', { precision: 20, scale: 4 }).notNull(),
    countedAmount: numeric('counted_amount', { precision: 20, scale: 4 }).notNull(),
    variance: numeric('variance', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    explanation: text('explanation'),
    countedBy: uuid('counted_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('cash_counts_tenant_id_id_uidx').on(table.tenantId, table.id),
    index('cash_counts_tenant_station_date_idx').on(
      table.tenantId,
      table.stationId,
      table.businessDate,
    ),
    check(
      'cash_counts_amounts_ck',
      sql`${table.expectedAmount} >= 0 and ${table.countedAmount} >= 0`,
    ),
    check(
      'cash_counts_variance_ck',
      sql`${table.variance} = ${table.countedAmount} - ${table.expectedAmount}`,
    ),
    check('cash_counts_currency_ck', sql`${table.currency} = 'USD'`),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'cash_counts_tenant_station_fk',
    }),
    cashLocationScope(table, 'cash_counts_location_fk'),
    foreignKey({
      columns: [table.tenantId, table.countedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'cash_counts_counted_by_fk',
    }),
  ],
);

export const cashHandovers = appSchema.table(
  'cash_handovers',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    fromLocationId: uuid('from_location_id').notNull(),
    toLocationId: uuid('to_location_id').notNull(),
    expectedAmount: numeric('expected_amount', { precision: 20, scale: 4 }).notNull(),
    countedAmount: numeric('counted_amount', { precision: 20, scale: 4 }),
    variance: numeric('variance', { precision: 20, scale: 4 }),
    currency: text('currency').notNull().default('USD'),
    state: text('state').notNull().default('DRAFT'),
    deliveredBy: uuid('delivered_by').notNull(),
    receivedBy: uuid('received_by'),
    disputeReason: text('dispute_reason'),
    submittedAt: utcTimestamp('submitted_at'),
    acceptedAt: utcTimestamp('accepted_at'),
    version: integer('version').notNull().default(0),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('cash_handovers_tenant_id_id_uidx').on(table.tenantId, table.id),
    index('cash_handovers_tenant_station_state_idx').on(
      table.tenantId,
      table.stationId,
      table.state,
    ),
    check(
      'cash_handovers_locations_differ_ck',
      sql`${table.fromLocationId} <> ${table.toLocationId}`,
    ),
    check(
      'cash_handovers_amounts_ck',
      sql`${table.expectedAmount} > 0 and (${table.countedAmount} is null or ${table.countedAmount} >= 0)`,
    ),
    check(
      'cash_handovers_variance_ck',
      sql`${table.variance} is null or ${table.variance} = ${table.countedAmount} - ${table.expectedAmount}`,
    ),
    check('cash_handovers_currency_ck', sql`${table.currency} = 'USD'`),
    check(
      'cash_handovers_state_ck',
      sql`${table.state} in ('DRAFT','SUBMITTED','ACCEPTED','DISPUTED','RESOLVED','CANCELLED')`,
    ),
    cashLocationScope(
      { tenantId: table.tenantId, stationId: table.stationId, locationId: table.fromLocationId },
      'cash_handovers_from_location_fk',
    ),
    cashLocationScope(
      { tenantId: table.tenantId, stationId: table.stationId, locationId: table.toLocationId },
      'cash_handovers_to_location_fk',
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'cash_handovers_tenant_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.deliveredBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'cash_handovers_delivered_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.receivedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'cash_handovers_received_by_fk',
    }),
  ],
);

export const bankAccounts = appSchema.table(
  'bank_accounts',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    name: text('name').notNull(),
    bankName: text('bank_name').notNull(),
    accountReferenceMasked: text('account_reference_masked').notNull(),
    currency: text('currency').notNull().default('USD'),
    status: text('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(0),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('bank_accounts_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('bank_accounts_tenant_legal_entity_name_uidx').on(
      table.tenantId,
      table.legalEntityId,
      table.name,
    ),
    check('bank_accounts_currency_ck', sql`${table.currency} = 'USD'`),
    check('bank_accounts_status_ck', sql`${table.status} in ('ACTIVE','INACTIVE')`),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'bank_accounts_tenant_legal_entity_fk',
    }),
  ],
);

export const bankDeposits = appSchema.table(
  'bank_deposits',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    sourceLocationId: uuid('source_location_id').notNull(),
    bankAccountId: uuid('bank_account_id').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    depositReference: text('deposit_reference').notNull(),
    state: text('state').notNull().default('RECORDED'),
    version: integer('version').notNull().default(0),
    depositedAt: utcTimestamp('deposited_at').notNull(),
    expectedConfirmationAt: utcTimestamp('expected_confirmation_at'),
    confirmedAmount: numeric('confirmed_amount', { precision: 20, scale: 4 }),
    confirmationVariance: numeric('confirmation_variance', { precision: 20, scale: 4 }),
    bankReference: text('bank_reference'),
    confirmedAt: utcTimestamp('confirmed_at'),
    recordedBy: uuid('recorded_by').notNull(),
    confirmedBy: uuid('confirmed_by'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('bank_deposits_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('bank_deposits_tenant_station_reference_uidx').on(
      table.tenantId,
      table.stationId,
      table.depositReference,
    ),
    index('bank_deposits_tenant_state_idx').on(table.tenantId, table.state),
    check(
      'bank_deposits_amount_ck',
      sql`${table.amount} > 0 and (${table.confirmedAmount} is null or ${table.confirmedAmount} >= 0)`,
    ),
    check(
      'bank_deposits_variance_ck',
      sql`${table.confirmationVariance} is null or ${table.confirmationVariance} = ${table.confirmedAmount} - ${table.amount}`,
    ),
    check('bank_deposits_currency_ck', sql`${table.currency} = 'USD'`),
    check(
      'bank_deposits_state_ck',
      sql`${table.state} in ('RECORDED','SUBMITTED','CONFIRMED','REJECTED','REVERSED')`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'bank_deposits_tenant_station_fk',
    }),
    cashLocationScope(
      { tenantId: table.tenantId, stationId: table.stationId, locationId: table.sourceLocationId },
      'bank_deposits_source_location_fk',
    ),
    foreignKey({
      columns: [table.tenantId, table.bankAccountId],
      foreignColumns: [bankAccounts.tenantId, bankAccounts.id],
      name: 'bank_deposits_bank_account_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'bank_deposits_recorded_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.confirmedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'bank_deposits_confirmed_by_fk',
    }),
  ],
);

export const bankDepositAllocations = appSchema.table(
  'bank_deposit_allocations',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    depositId: uuid('deposit_id').notNull(),
    collectionId: uuid('collection_id').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    allocatedBy: uuid('allocated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('bank_deposit_allocations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('bank_deposit_allocations_deposit_collection_uidx').on(
      table.tenantId,
      table.stationId,
      table.depositId,
      table.collectionId,
    ),
    index('bank_deposit_allocations_collection_idx').on(
      table.tenantId,
      table.stationId,
      table.collectionId,
    ),
    check('bank_deposit_allocations_amount_ck', sql`${table.amount} > 0`),
    check('bank_deposit_allocations_currency_ck', sql`${table.currency} = 'USD'`),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.depositId],
      foreignColumns: [bankDeposits.tenantId, bankDeposits.stationId, bankDeposits.id],
      name: 'bank_deposit_allocations_deposit_fk',
    }),
    cashCollectionScope(table, 'bank_deposit_allocations_collection_fk'),
    foreignKey({
      columns: [table.tenantId, table.allocatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'bank_deposit_allocations_allocated_by_fk',
    }),
  ],
);

export const providerBatches = appSchema.table(
  'provider_batches',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    providerCode: text('provider_code').notNull(),
    businessDate: text('business_date').notNull(),
    externalReference: text('external_reference').notNull(),
    declaredGross: numeric('declared_gross', { precision: 20, scale: 4 }).notNull(),
    declaredFees: numeric('declared_fees', { precision: 20, scale: 4 }).notNull().default('0'),
    declaredRefunds: numeric('declared_refunds', { precision: 20, scale: 4 })
      .notNull()
      .default('0'),
    expectedNet: numeric('expected_net', { precision: 20, scale: 4 }).notNull(),
    state: text('state').notNull().default('DECLARED'),
    declaredBy: uuid('declared_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('provider_batches_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('provider_batches_tenant_provider_reference_uidx').on(
      table.tenantId,
      table.providerCode,
      table.externalReference,
    ),
    index('provider_batches_tenant_station_date_idx').on(
      table.tenantId,
      table.stationId,
      table.businessDate,
    ),
    check(
      'provider_batches_amounts_ck',
      sql`${table.declaredGross} > 0 and ${table.declaredFees} >= 0 and ${table.declaredRefunds} >= 0 and ${table.expectedNet} = ${table.declaredGross} - ${table.declaredFees} - ${table.declaredRefunds}`,
    ),
    check(
      'provider_batches_state_ck',
      sql`${table.state} in ('DECLARED','MATCHED','SETTLED','DISPUTED','REVERSED')`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'provider_batches_tenant_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.declaredBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'provider_batches_declared_by_fk',
    }),
  ],
);

export const providerSettlements = appSchema.table(
  'provider_settlements',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    providerBatchId: uuid('provider_batch_id').notNull(),
    settledNet: numeric('settled_net', { precision: 20, scale: 4 }).notNull(),
    variance: numeric('variance', { precision: 20, scale: 4 }).notNull(),
    settlementReference: text('settlement_reference').notNull(),
    settledAt: utcTimestamp('settled_at').notNull(),
    state: text('state').notNull().default('POSTED'),
    recordedBy: uuid('recorded_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('provider_settlements_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('provider_settlements_batch_uidx').on(table.tenantId, table.providerBatchId),
    check('provider_settlements_amount_ck', sql`${table.settledNet} >= 0`),
    check('provider_settlements_state_ck', sql`${table.state} in ('POSTED','REVERSED')`),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.providerBatchId],
      foreignColumns: [providerBatches.tenantId, providerBatches.stationId, providerBatches.id],
      name: 'provider_settlements_batch_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'provider_settlements_recorded_by_fk',
    }),
  ],
);
