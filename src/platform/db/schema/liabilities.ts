import { sql } from 'drizzle-orm';
import { check, foreignKey, index, numeric, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { legalEntities, memberships, stations, tenants } from './a1';

export const approvedLiabilityEntries = appSchema.table(
  'approved_liability_entries',
  {
    id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id'),
    liabilityAccountId: uuid('liability_account_id').notNull(),
    originalEntryId: uuid('original_entry_id'),
    liabilityKind: text('liability_kind').notNull(),
    entryType: text('entry_type').notNull(),
    direction: text('direction').notNull(),
    counterpartyName: text('counterparty_name').notNull(),
    reference: text('reference').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    effectiveDate: text('effective_date').notNull(),
    dueDate: text('due_date'),
    reason: text('reason'),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('approved_liability_entries_tenant_id_uidx').on(table.tenantId, table.id),
    unique('approved_liability_entries_source_uidx').on(
      table.tenantId,
      table.liabilityAccountId,
      table.reference,
      table.entryType,
    ),
    index('approved_liability_entries_scope_date_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.stationId,
      table.effectiveDate,
    ),
    check(
      'approved_liability_entries_kind_ck',
      sql`${table.liabilityKind} in ('TRANSPORTER','OTHER')`,
    ),
    check(
      'approved_liability_entries_type_ck',
      sql`${table.entryType} in ('RECOGNITION','ADJUSTMENT','REVERSAL')`,
    ),
    check(
      'approved_liability_entries_direction_ck',
      sql`${table.direction} in ('INCREASE','DECREASE')`,
    ),
    check('approved_liability_entries_amount_ck', sql`${table.amount} > 0`),
    check('approved_liability_entries_currency_ck', sql`${table.currency} = 'USD'`),
    check(
      'approved_liability_entries_adjustment_ck',
      sql`(${table.entryType} = 'RECOGNITION' and ${table.originalEntryId} is null and ${table.direction} = 'INCREASE') or (${table.entryType} in ('ADJUSTMENT','REVERSAL') and ${table.originalEntryId} is not null)`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'approved_liability_entries_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'approved_liability_entries_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'approved_liability_entries_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.originalEntryId],
      foreignColumns: [table.tenantId, table.id],
      name: 'approved_liability_entries_original_entry_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'approved_liability_entries_actor_fk',
    }),
  ],
);
