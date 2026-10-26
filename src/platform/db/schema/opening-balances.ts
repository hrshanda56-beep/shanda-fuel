import { sql } from 'drizzle-orm';
import {
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
import { bankAccounts, cashLocations } from './a6';
import { customerAccounts, customers } from './a8';
import { legalEntities, memberships, stations, tenants } from './a1';
import { suppliers } from './a7';
import { tanks } from './a4';
import { products } from './a3';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 20, scale: 4 });
const litres = (name: string) => numeric(name, { precision: 18, scale: 3 });

export const openingBalanceBatches = appSchema.table(
  'opening_balance_batches',
  {
    id: id(),
    tenantId: tenantId(),
    asOfDate: text('as_of_date').notNull(),
    sourceFilename: text('source_filename'),
    sourceHash: text('source_hash').notNull(),
    state: text('state').notNull().default('DRAFT'),
    lineCount: integer('line_count').notNull(),
    createdBy: uuid('created_by').notNull(),
    approvedBy: uuid('approved_by'),
    approvedAt: utcTimestamp('approved_at'),
    lockedBy: uuid('locked_by'),
    lockedAt: utcTimestamp('locked_at'),
    version: integer('version').notNull().default(0),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('opening_balance_batches_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('opening_balance_batches_tenant_hash_uidx').on(table.tenantId, table.sourceHash),
    index('opening_balance_batches_tenant_state_idx').on(table.tenantId, table.state),
    check('opening_balance_batches_state_ck', sql`${table.state} in ('DRAFT','APPROVED','LOCKED')`),
    check('opening_balance_batches_line_count_ck', sql`${table.lineCount} > 0`),
    check('opening_balance_batches_hash_ck', sql`btrim(${table.sourceHash}) <> ''`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'opening_balance_batches_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'opening_balance_batches_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'opening_balance_batches_approved_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lockedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'opening_balance_batches_locked_by_fk',
    }),
  ],
);

export const openingBalanceLines = appSchema.table(
  'opening_balance_lines',
  {
    id: id(),
    tenantId: tenantId(),
    batchId: uuid('batch_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    lineKey: text('line_key').notNull(),
    lineType: text('line_type').notNull(),
    legalEntityId: uuid('legal_entity_id'),
    stationId: uuid('station_id'),
    supplierId: uuid('supplier_id'),
    customerId: uuid('customer_id'),
    accountId: uuid('account_id'),
    cashLocationId: uuid('cash_location_id'),
    bankAccountId: uuid('bank_account_id'),
    tankId: uuid('tank_id'),
    productId: uuid('product_id'),
    reference: text('reference'),
    effectiveDate: text('effective_date').notNull(),
    dueDate: text('due_date'),
    amount: money('amount'),
    quantityLitres: litres('quantity_litres'),
    inventoryValue: money('inventory_value'),
    currency: text('currency').notNull().default('USD'),
    notes: text('notes'),
    rawRow: jsonb('raw_row').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('opening_balance_lines_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('opening_balance_lines_batch_line_number_uidx').on(
      table.tenantId,
      table.batchId,
      table.lineNumber,
    ),
    unique('opening_balance_lines_batch_line_key_uidx').on(
      table.tenantId,
      table.batchId,
      table.lineKey,
    ),
    index('opening_balance_lines_batch_idx').on(table.tenantId, table.batchId, table.lineNumber),
    check(
      'opening_balance_lines_type_ck',
      sql`${table.lineType} in ('SUPPLIER_INVOICE','CUSTOMER_CHARGE','CASH_BALANCE','BANK_BALANCE','TANK_STOCK')`,
    ),
    check('opening_balance_lines_currency_ck', sql`${table.currency} = 'USD'`),
    check('opening_balance_lines_amount_ck', sql`${table.amount} is null or ${table.amount} >= 0`),
    check(
      'opening_balance_lines_quantity_ck',
      sql`${table.quantityLitres} is null or ${table.quantityLitres} > 0`,
    ),
    check(
      'opening_balance_lines_inventory_value_ck',
      sql`${table.inventoryValue} is null or ${table.inventoryValue} > 0`,
    ),
    foreignKey({
      columns: [table.tenantId, table.batchId],
      foreignColumns: [openingBalanceBatches.tenantId, openingBalanceBatches.id],
      name: 'opening_balance_lines_batch_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'opening_balance_lines_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'opening_balance_lines_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'opening_balance_lines_supplier_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'opening_balance_lines_customer_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.accountId],
      foreignColumns: [customerAccounts.tenantId, customerAccounts.id],
      name: 'opening_balance_lines_account_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.cashLocationId],
      foreignColumns: [cashLocations.tenantId, cashLocations.stationId, cashLocations.id],
      name: 'opening_balance_lines_cash_location_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.bankAccountId],
      foreignColumns: [bankAccounts.tenantId, bankAccounts.id],
      name: 'opening_balance_lines_bank_account_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.tankId],
      foreignColumns: [tanks.tenantId, tanks.stationId, tanks.id],
      name: 'opening_balance_lines_tank_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'opening_balance_lines_product_fk',
    }),
  ],
);

export const bankOpeningBalances = appSchema.table(
  'bank_opening_balances',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    bankAccountId: uuid('bank_account_id').notNull(),
    amount: money('amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    effectiveDate: text('effective_date').notNull(),
    sourceBatchId: uuid('source_batch_id').notNull(),
    sourceLineId: uuid('source_line_id').notNull(),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('bank_opening_balances_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('bank_opening_balances_account_uidx').on(table.tenantId, table.bankAccountId),
    unique('bank_opening_balances_source_line_uidx').on(table.tenantId, table.sourceLineId),
    check('bank_opening_balances_amount_ck', sql`${table.amount} >= 0`),
    check('bank_opening_balances_currency_ck', sql`${table.currency} = 'USD'`),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'bank_opening_balances_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.bankAccountId],
      foreignColumns: [bankAccounts.tenantId, bankAccounts.id],
      name: 'bank_opening_balances_account_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.sourceBatchId],
      foreignColumns: [openingBalanceBatches.tenantId, openingBalanceBatches.id],
      name: 'bank_opening_balances_batch_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.sourceLineId],
      foreignColumns: [openingBalanceLines.tenantId, openingBalanceLines.id],
      name: 'bank_opening_balances_line_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'bank_opening_balances_actor_fk',
    }),
  ],
);
