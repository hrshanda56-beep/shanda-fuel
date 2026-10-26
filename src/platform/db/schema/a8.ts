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
import { documents } from './documents';

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
    /** Usual days to pay, credit accounts only. Informational; never blocks a sale. */
    creditDays: integer('credit_days'),
    /** Copy of the customer's legal entity; kept equal by a composite foreign key. */
    legalEntityId: uuid('legal_entity_id'),
    /** `ALL`: every station of the legal entity. `SELECTED`: only active customer_account_stations rows. */
    stationScope: text('station_scope').notNull().default('ALL'),
    /** False for migrated rows until an owner/administrator explicitly confirms scope. */
    stationScopeConfigured: boolean('station_scope_configured').notNull().default(false),
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
    check(
      'customer_accounts_credit_days_ck',
      sql`${table.creditDays} is null or (${table.accountType} = 'CREDIT' and ${table.creditDays} between 0 and 365)`,
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
    /** Station where a customer payment's cash was received (ADR-017). */
    receivingStationId: uuid('receiving_station_id'),
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
      columns: [table.tenantId, table.receivingStationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'customer_ledger_entries_receiving_station_fk',
    }),
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

/** S13 (0060): vehicle, driver, voucher, approver and document for one ledger entry. Append-only. */
export const customerLedgerEntryDetails = appSchema.table(
  'customer_ledger_entry_details',
  {
    id: id(),
    tenantId: tenantId(),
    ledgerEntryId: uuid('ledger_entry_id').notNull(),
    accountId: uuid('account_id').notNull(),
    vehicleRegistration: text('vehicle_registration'),
    driverName: text('driver_name'),
    voucherNumber: text('voucher_number'),
    approvedByMembershipId: uuid('approved_by_membership_id'),
    documentId: uuid('document_id'),
    recordedBy: uuid('recorded_by').notNull(),
    recordedAt: utcTimestamp('recorded_at').notNull().defaultNow(),
  },
  (table) => [
    unique('customer_ledger_entry_details_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('customer_ledger_entry_details_entry_uidx').on(table.tenantId, table.ledgerEntryId),
    index('customer_ledger_entry_details_account_idx').on(table.tenantId, table.accountId),
    foreignKey({
      columns: [table.tenantId, table.ledgerEntryId],
      foreignColumns: [customerLedgerEntries.tenantId, customerLedgerEntries.id],
      name: 'customer_ledger_entry_details_entry_fk',
    }),
    accountScope(table, 'customer_ledger_entry_details_account_fk'),
    foreignKey({
      columns: [table.tenantId, table.approvedByMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customer_ledger_entry_details_approver_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customer_ledger_entry_details_recorded_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: 'customer_ledger_entry_details_document_fk',
    }),
  ],
);

/** S13 (0061): append-only history of management credit-limit overrides. */
export const customerCreditLimitOverrides = appSchema.table(
  'customer_credit_limit_overrides',
  {
    id: id(),
    tenantId: tenantId(),
    accountId: uuid('account_id').notNull(),
    previousLimit: money('previous_limit').notNull(),
    newLimit: money('new_limit').notNull(),
    approvedByMembershipId: uuid('approved_by_membership_id').notNull(),
    reason: text('reason').notNull(),
    recordedBy: uuid('recorded_by').notNull(),
    recordedAt: utcTimestamp('recorded_at').notNull().defaultNow(),
  },
  (table) => [
    unique('customer_credit_limit_overrides_tenant_id_id_uidx').on(table.tenantId, table.id),
    index('customer_credit_limit_overrides_account_idx').on(
      table.tenantId,
      table.accountId,
      table.recordedAt,
    ),
    check(
      'customer_credit_limit_overrides_limits_ck',
      sql`${table.previousLimit} >= 0 and ${table.newLimit} > 0 and ${table.newLimit} <> ${table.previousLimit}`,
    ),
    check(
      'customer_credit_limit_overrides_reason_ck',
      sql`btrim(${table.reason}) <> '' and char_length(${table.reason}) <= 500`,
    ),
    accountScope(table, 'customer_credit_limit_overrides_account_fk'),
    foreignKey({
      columns: [table.tenantId, table.approvedByMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customer_credit_limit_overrides_approver_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customer_credit_limit_overrides_recorded_by_fk',
    }),
  ],
);

/** S13 (0070): marks a CREDIT account as a staff fuel benefit. The period limit is `credit_limit`. */
export const customerStaffBenefitTerms = appSchema.table(
  'customer_staff_benefit_terms',
  {
    id: id(),
    tenantId: tenantId(),
    accountId: uuid('account_id').notNull(),
    staffName: text('staff_name').notNull(),
    staffMembershipId: uuid('staff_membership_id'),
    periodKind: text('period_kind').notNull().default('MONTHLY'),
    limitBasis: text('limit_basis').notNull().default('USD'),
    createdBy: uuid('created_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('customer_staff_benefit_terms_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('customer_staff_benefit_terms_account_uidx').on(table.tenantId, table.accountId),
    check(
      'customer_staff_benefit_terms_name_ck',
      sql`btrim(${table.staffName}) <> '' and char_length(${table.staffName}) <= 200`,
    ),
    check('customer_staff_benefit_terms_period_ck', sql`${table.periodKind} in ('MONTHLY')`),
    check('customer_staff_benefit_terms_basis_ck', sql`${table.limitBasis} in ('USD')`),
    accountScope(table, 'customer_staff_benefit_terms_account_fk'),
    foreignKey({
      columns: [table.tenantId, table.staffMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customer_staff_benefit_terms_staff_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'customer_staff_benefit_terms_created_by_fk',
    }),
  ],
);
