import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { legalEntities, memberships, stations, tenants } from './a1';
import { reconciliationPayments } from './a5';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });

export const paymentProviders = appSchema.table(
  'payment_providers',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    providerType: text('provider_type').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('payment_providers_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('payment_providers_tenant_code_uidx').on(table.tenantId, table.code),
    index('payment_providers_tenant_status_idx').on(table.tenantId, table.status),
    check(
      'payment_providers_type_ck',
      sql`${table.providerType} in ('CARD_ACQUIRER','POS','MOBILE_MONEY','OTHER_ELECTRONIC')`,
    ),
    check('payment_providers_status_ck', sql`${table.status} in ('ACTIVE','INACTIVE')`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'payment_providers_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'payment_providers_created_by_fk',
    }),
  ],
);

export const providerAccounts = appSchema.table(
  'provider_accounts',
  {
    id: id(),
    tenantId: tenantId(),
    providerId: uuid('provider_id').notNull(),
    legalEntityId: uuid('legal_entity_id'),
    stationId: uuid('station_id'),
    accountReference: text('account_reference').notNull(),
    displayName: text('display_name').notNull(),
    currency: text('currency').notNull().default('USD'),
    status: text('status').notNull().default('ACTIVE'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    version: integer('version').notNull().default(0),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('provider_accounts_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('provider_accounts_tenant_provider_reference_uidx').on(
      table.tenantId,
      table.providerId,
      table.accountReference,
    ),
    unique('provider_accounts_tenant_legal_entity_id_id_uidx').on(
      table.tenantId,
      table.legalEntityId,
      table.id,
    ),
    index('provider_accounts_tenant_station_status_idx').on(
      table.tenantId,
      table.stationId,
      table.status,
    ),
    check('provider_accounts_reference_nonempty_ck', sql`btrim(${table.accountReference}) <> ''`),
    check('provider_accounts_currency_ck', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('provider_accounts_status_ck', sql`${table.status} in ('ACTIVE','INACTIVE')`),
    foreignKey({
      columns: [table.tenantId, table.providerId],
      foreignColumns: [paymentProviders.tenantId, paymentProviders.id],
      name: 'provider_accounts_provider_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'provider_accounts_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'provider_accounts_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'provider_accounts_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'provider_accounts_updated_by_fk',
    }),
  ],
);

export const providerSettlements = appSchema.table(
  'provider_settlements',
  {
    id: id(),
    tenantId: tenantId(),
    providerAccountId: uuid('provider_account_id').notNull(),
    stationId: uuid('station_id').notNull(),
    settlementReference: text('settlement_reference').notNull(),
    batchReference: text('batch_reference'),
    transactionDate: text('transaction_date').notNull(),
    settlementDate: text('settlement_date').notNull(),
    currency: text('currency').notNull(),
    grossAmount: numeric('gross_amount', { precision: 20, scale: 4 }).notNull(),
    providerFeeAmount: numeric('provider_fee_amount', { precision: 20, scale: 4 }),
    providerDeductionAmount: numeric('provider_deduction_amount', {
      precision: 20,
      scale: 4,
    }),
    reportedNetAmount: numeric('reported_net_amount', { precision: 20, scale: 4 }),
    sourceType: text('source_type').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceMetadata: jsonb('source_metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    state: text('state').notNull().default('RECORDED'),
    version: integer('version').notNull().default(0),
    recordedBy: uuid('recorded_by').notNull(),
    reconciledBy: uuid('reconciled_by'),
    reconciledAt: utcTimestamp('reconciled_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('provider_settlements_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('provider_settlements_tenant_station_id_id_uidx').on(
      table.tenantId,
      table.stationId,
      table.id,
    ),
    unique('provider_settlements_account_reference_uidx').on(
      table.tenantId,
      table.providerAccountId,
      table.settlementReference,
    ),
    unique('provider_settlements_source_key_uidx').on(table.tenantId, table.sourceKey),
    index('provider_settlements_station_date_state_idx').on(
      table.tenantId,
      table.stationId,
      table.settlementDate,
      table.state,
    ),
    check(
      'provider_settlements_reference_nonempty_ck',
      sql`btrim(${table.settlementReference}) <> ''`,
    ),
    check(
      'provider_settlements_transaction_date_ck',
      sql`${table.transactionDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
    check(
      'provider_settlements_settlement_date_ck',
      sql`${table.settlementDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
    check('provider_settlements_currency_ck', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      'provider_settlements_amounts_ck',
      sql`${table.grossAmount} > 0 and coalesce(${table.providerFeeAmount}, 0) >= 0 and coalesce(${table.providerDeductionAmount}, 0) >= 0 and coalesce(${table.reportedNetAmount}, 0) >= 0`,
    ),
    check(
      'provider_settlements_source_type_ck',
      sql`${table.sourceType} in ('MANUAL','PROVIDER_IMPORT')`,
    ),
    check(
      'provider_settlements_state_ck',
      sql`${table.state} in ('RECORDED','PARTIALLY_MATCHED','RECONCILED','EXCEPTION')`,
    ),
    foreignKey({
      columns: [table.tenantId, table.providerAccountId],
      foreignColumns: [providerAccounts.tenantId, providerAccounts.id],
      name: 'provider_settlements_account_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'provider_settlements_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'provider_settlements_recorded_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reconciledBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'provider_settlements_reconciled_by_fk',
    }),
  ],
);

const settlementScope = (
  table: { tenantId: AnyPgColumn; stationId: AnyPgColumn; settlementId: AnyPgColumn },
  name: string,
) =>
  foreignKey({
    columns: [table.tenantId, table.stationId, table.settlementId],
    foreignColumns: [
      providerSettlements.tenantId,
      providerSettlements.stationId,
      providerSettlements.id,
    ],
    name,
  });

export const providerSettlementAllocations = appSchema.table(
  'provider_settlement_allocations',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    settlementId: uuid('settlement_id').notNull(),
    reconciliationPaymentId: uuid('reconciliation_payment_id').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    allocationKey: text('allocation_key').notNull(),
    state: text('state').notNull().default('POSTED'),
    reversalOfId: uuid('reversal_of_id'),
    allocatedBy: uuid('allocated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('provider_settlement_allocations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('provider_settlement_allocations_key_uidx').on(table.tenantId, table.allocationKey),
    index('provider_settlement_allocations_payment_idx').on(
      table.tenantId,
      table.stationId,
      table.reconciliationPaymentId,
      table.state,
    ),
    index('provider_settlement_allocations_settlement_idx').on(
      table.tenantId,
      table.stationId,
      table.settlementId,
      table.state,
    ),
    check('provider_settlement_allocations_amount_ck', sql`${table.amount} > 0`),
    check('provider_settlement_allocations_state_ck', sql`${table.state} in ('POSTED','REVERSED')`),
    check(
      'provider_settlement_allocations_reversal_ck',
      sql`(${table.state} = 'POSTED' and ${table.reversalOfId} is null) or (${table.state} = 'REVERSED' and ${table.reversalOfId} is not null)`,
    ),
    settlementScope(table, 'provider_settlement_allocations_settlement_fk'),
    foreignKey({
      columns: [table.tenantId, table.reconciliationPaymentId],
      foreignColumns: [reconciliationPayments.tenantId, reconciliationPayments.id],
      name: 'provider_settlement_allocations_payment_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'provider_settlement_allocations_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reversalOfId],
      foreignColumns: [table.tenantId, table.id],
      name: 'provider_settlement_allocations_reversal_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.allocatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'provider_settlement_allocations_allocated_by_fk',
    }),
  ],
);
