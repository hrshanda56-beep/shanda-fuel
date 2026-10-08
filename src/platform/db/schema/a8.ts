import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  boolean,
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
import { products } from './a3';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 20, scale: 4 });
const litres = (name: string) => numeric(name, { precision: 18, scale: 3 });

export const customers = appSchema.table(
  'customers',
  {
    id: id(),
    tenantId: tenantId(),
    accountReference: text('account_reference').notNull(),
    displayName: text('display_name').notNull(),
    contactMetadata: jsonb('contact_metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** The one legal entity this customer's credit is with (ADR-017). Null until onboarding confirms it. */
    legalEntityId: uuid('legal_entity_id'),
    status: text('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(0),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('customers_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('customers_tenant_id_id_legal_entity_uidx').on(
      table.tenantId,
      table.id,
      table.legalEntityId,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'customers_legal_entity_fk',
    }),
    unique('customers_tenant_reference_uidx').on(table.tenantId, table.accountReference),
    index('customers_tenant_status_idx').on(table.tenantId, table.status),
    check('customers_reference_nonempty_ck', sql`btrim(${table.accountReference}) <> ''`),
    check('customers_name_nonempty_ck', sql`btrim(${table.displayName}) <> ''`),
    check('customers_status_ck', sql`${table.status} in ('ACTIVE','SUSPENDED','CLOSED')`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'customers_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customers_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customers_updated_by_fk',
    }),
  ],
);

export const customerAccounts = appSchema.table(
  'customer_accounts',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id').notNull(),
    accountType: text('account_type').notNull(),
    currency: text('currency').notNull().default('USD'),
    creditLimit: money('credit_limit'),
    /** Copy of the customer's legal entity; kept equal by a composite foreign key. */
    legalEntityId: uuid('legal_entity_id'),
    /** `ALL`: every station of the legal entity. `SELECTED`: only active customer_account_stations rows. */
    stationScope: text('station_scope').notNull().default('ALL'),
    status: text('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(0),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('customer_accounts_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('customer_accounts_tenant_id_id_legal_entity_uidx').on(
      table.tenantId,
      table.id,
      table.legalEntityId,
    ),
    check('customer_accounts_station_scope_ck', sql`${table.stationScope} in ('ALL','SELECTED')`),
    foreignKey({
      columns: [table.tenantId, table.customerId, table.legalEntityId],
      foreignColumns: [customers.tenantId, customers.id, customers.legalEntityId],
      name: 'customer_accounts_customer_legal_entity_fk',
    }),
    index('customer_accounts_tenant_customer_status_idx').on(
      table.tenantId,
      table.customerId,
      table.status,
    ),
    check(
      'customer_accounts_type_ck',
      sql`${table.accountType} in ('CREDIT','PREPAID_VALUE','PREPAID_LITRES')`,
    ),
    check('customer_accounts_currency_ck', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('customer_accounts_status_ck', sql`${table.status} in ('ACTIVE','SUSPENDED','CLOSED')`),
    check(
      'customer_accounts_credit_limit_ck',
      sql`${table.creditLimit} is null or (${table.accountType} = 'CREDIT' and ${table.creditLimit} >= 0)`,
    ),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'customer_accounts_customer_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customer_accounts_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customer_accounts_updated_by_fk',
    }),
  ],
);

export const customerAccountStations = appSchema.table(
  'customer_account_stations',
  {
    id: id(),
    tenantId: tenantId(),
    accountId: uuid('account_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('customer_account_stations_account_station_uidx').on(
      table.tenantId,
      table.accountId,
      table.stationId,
    ),
    index('customer_account_stations_station_idx')
      .on(table.tenantId, table.stationId)
      .where(sql`${table.active}`),
    foreignKey({
      columns: [table.tenantId, table.accountId, table.legalEntityId],
      foreignColumns: [
        customerAccounts.tenantId,
        customerAccounts.id,
        customerAccounts.legalEntityId,
      ],
      name: 'customer_account_stations_account_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'customer_account_stations_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customer_account_stations_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customer_account_stations_updated_by_fk',
    }),
  ],
);

const accountScope = (table: { tenantId: AnyPgColumn; accountId: AnyPgColumn }, name: string) =>
  foreignKey({
    columns: [table.tenantId, table.accountId],
    foreignColumns: [customerAccounts.tenantId, customerAccounts.id],
    name,
  });

export const customerLedgerEntries = appSchema.table(
  'customer_ledger_entries',
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid('customer_id').notNull(),
    accountId: uuid('account_id').notNull(),
    accountType: text('account_type').notNull(),
    entryType: text('entry_type').notNull(),
    direction: text('direction').notNull(),
    amount: money('amount'),
    productId: uuid('product_id'),
    quantityLitres: litres('quantity_litres'),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    sourceRevisionId: uuid('source_revision_id'),
    sourceKey: text('source_key').notNull(),
    occurredAt: utcTimestamp('occurred_at').notNull(),
    businessDate: text('business_date').notNull(),
    note: text('note'),
    reason: text('reason'),
    fuelAllocationId: uuid('fuel_allocation_id'),
    reversalOfEntryId: uuid('reversal_of_entry_id'),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('customer_ledger_entries_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('customer_ledger_entries_source_key_uidx').on(
      table.tenantId,
      table.accountId,
      table.sourceKey,
    ),
    index('customer_ledger_entries_account_occurred_idx').on(
      table.tenantId,
      table.accountId,
      table.occurredAt,
      table.id,
    ),
    check(
      'customer_ledger_entries_type_ck',
      sql`${table.accountType} in ('CREDIT','PREPAID_VALUE','PREPAID_LITRES')`,
    ),
    check(
      'customer_ledger_entries_entry_type_ck',
      sql`${table.entryType} in ('CREDIT_FUEL_CHARGE','CUSTOMER_PAYMENT','PREPAID_TOPUP','PREPAID_FUEL_USAGE','ADJUSTMENT','REVERSAL')`,
    ),
    check(
      'customer_ledger_entries_direction_ck',
      sql`${table.direction} in ('INCREASE','DECREASE')`,
    ),
    check(
      'customer_ledger_entries_source_type_ck',
      sql`${table.sourceType} in ('A5_RECONCILIATION_CUSTOMER_FUEL','CUSTOMER_PAYMENT','PREPAID_TOPUP','MANUAL_ADJUSTMENT','LEDGER_REVERSAL')`,
    ),
    check(
      'customer_ledger_entries_value_shape_ck',
      sql`(
      (${table.accountType} in ('CREDIT','PREPAID_VALUE') and ${table.amount} > 0 and ${table.quantityLitres} is null and (${table.productId} is null or ${table.accountType} = 'CREDIT'))
      or (${table.accountType} = 'PREPAID_LITRES' and ${table.amount} is null and ${table.quantityLitres} > 0 and ${table.productId} is not null)
    )`,
    ),
    check(
      'customer_ledger_entries_entry_account_ck',
      sql`(
      (${table.accountType} = 'CREDIT' and ${table.entryType} in ('CREDIT_FUEL_CHARGE','CUSTOMER_PAYMENT','ADJUSTMENT','REVERSAL'))
      or (${table.accountType} = 'PREPAID_VALUE' and ${table.entryType} in ('PREPAID_TOPUP','PREPAID_FUEL_USAGE','ADJUSTMENT','REVERSAL'))
      or (${table.accountType} = 'PREPAID_LITRES' and ${table.entryType} in ('PREPAID_TOPUP','PREPAID_FUEL_USAGE','ADJUSTMENT','REVERSAL'))
    )`,
    ),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'customer_ledger_entries_customer_fk',
    }),
    accountScope(table, 'customer_ledger_entries_account_fk'),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customer_ledger_entries_actor_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'customer_ledger_entries_product_fk',
    }),
  ],
);

export const customerFuelAuthorizations = appSchema.table(
  'customer_fuel_authorizations',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    accountId: uuid('account_id').notNull(),
    accountType: text('account_type').notNull(),
    productId: uuid('product_id').notNull(),
    currency: text('currency').notNull().default('USD'),
    requestedAmount: money('requested_amount').notNull(),
    requestedLitres: litres('requested_litres').notNull(),
    usedAmount: money('used_amount').notNull().default('0'),
    usedLitres: litres('used_litres').notNull().default('0'),
    remainingAmount: money('remaining_amount').notNull(),
    remainingLitres: litres('remaining_litres').notNull(),
    state: text('state').notNull().default('REQUESTED'),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    sourceRevisionId: uuid('source_revision_id'),
    sourceKey: text('source_key').notNull(),
    requestedBy: uuid('requested_by').notNull(),
    requestedAt: utcTimestamp('requested_at').notNull(),
    authorizedAt: utcTimestamp('authorized_at'),
    completedAt: utcTimestamp('completed_at'),
    closedReason: text('closed_reason'),
    version: integer('version').notNull().default(0),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('customer_fuel_authorizations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('customer_fuel_authorizations_source_key_uidx').on(table.tenantId, table.sourceKey),
    index('customer_fuel_authorizations_account_state_idx').on(
      table.tenantId,
      table.accountId,
      table.state,
    ),
    index('customer_fuel_authorizations_station_state_idx').on(
      table.tenantId,
      table.stationId,
      table.state,
    ),
    check(
      'customer_fuel_authorizations_type_ck',
      sql`${table.accountType} in ('CREDIT','PREPAID_VALUE','PREPAID_LITRES')`,
    ),
    check('customer_fuel_authorizations_currency_ck', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      'customer_fuel_authorizations_state_ck',
      sql`${table.state} in ('REQUESTED','AUTHORIZED','PARTIALLY_USED','COMPLETED','CANCELLED','EXPIRED','REJECTED')`,
    ),
    check(
      'customer_fuel_authorizations_amounts_ck',
      sql`${table.requestedAmount} > 0 and ${table.requestedLitres} > 0 and ${table.usedAmount} >= 0 and ${table.usedLitres} >= 0 and ${table.remainingAmount} >= 0 and ${table.remainingLitres} >= 0`,
    ),
    check(
      'customer_fuel_authorizations_totals_ck',
      sql`${table.requestedAmount} = ${table.usedAmount} + ${table.remainingAmount} and ${table.requestedLitres} = ${table.usedLitres} + ${table.remainingLitres}`,
    ),
    accountScope(table, 'customer_fuel_authorizations_account_fk'),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'customer_fuel_authorizations_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'customer_fuel_authorizations_customer_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.requestedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customer_fuel_authorizations_requested_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'customer_fuel_authorizations_product_fk',
    }),
  ],
);
