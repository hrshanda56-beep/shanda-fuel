import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
  boolean,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { legalEntities, memberships, stations, tenants } from './a1';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 20, scale: 4 });

/** Versioned, effective-dated configuration for recurring cost generation. */
export const expenseRecurringTemplates = appSchema.table(
  'expense_recurring_templates',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id'),
    description: text('description').notNull(),
    category: text('category'),
    amount: money('amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    settlementSource: text('settlement_source').notNull(),
    intervalUnit: text('interval_unit').notNull(),
    intervalCount: integer('interval_count').notNull(),
    anchorDate: text('anchor_date').notNull(),
    active: boolean('active').notNull().default(true),
    approvalRequired: boolean('approval_required').notNull().default(true),
    requiredApproverCount: integer('required_approver_count').notNull().default(1),
    requiresStepUp: boolean('requires_step_up').notNull().default(false),
    stepUpThreshold: money('step_up_threshold'),
    secondApproverThreshold: money('second_approver_threshold'),
    version: integer('version').notNull().default(0),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('expense_recurring_templates_tenant_id_id_uidx').on(table.tenantId, table.id),
    index('expense_recurring_templates_scope_active_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.stationId,
      table.active,
    ),
    check(
      'expense_recurring_templates_description_nonempty_ck',
      sql`btrim(${table.description}) <> ''`,
    ),
    check(
      'expense_recurring_templates_category_nonempty_ck',
      sql`${table.category} is null or btrim(${table.category}) <> ''`,
    ),
    check('expense_recurring_templates_amount_positive_ck', sql`${table.amount} > 0`),
    check('expense_recurring_templates_currency_ck', sql`${table.currency} = 'USD'`),
    check(
      'expense_recurring_templates_settlement_source_ck',
      sql`${table.settlementSource} in ('CASH','BANK','PAYABLE','REIMBURSEMENT')`,
    ),
    check(
      'expense_recurring_templates_interval_unit_ck',
      sql`${table.intervalUnit} in ('DAY','WEEK','MONTH','YEAR')`,
    ),
    check(
      'expense_recurring_templates_interval_count_ck',
      sql`${table.intervalCount} between 1 and 3650`,
    ),
    check(
      'expense_recurring_templates_anchor_date_ck',
      sql`${table.anchorDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
    ),
    check(
      'expense_recurring_templates_required_approvers_ck',
      sql`${table.requiredApproverCount} between 0 and 2`,
    ),
    check(
      'expense_recurring_templates_approval_policy_ck',
      sql`${table.approvalRequired} = (${table.requiredApproverCount} > 0)`,
    ),
    check(
      'expense_recurring_templates_thresholds_ck',
      sql`(${table.stepUpThreshold} is null or ${table.stepUpThreshold} >= 0) and (${table.secondApproverThreshold} is null or ${table.secondApproverThreshold} >= 0)`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'expense_recurring_templates_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'expense_recurring_templates_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'expense_recurring_templates_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expense_recurring_templates_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expense_recurring_templates_updated_by_fk',
    }),
  ],
);

/**
 * Economic expense documents are separate from settlement/cash effects. A
 * posted expense is corrected by a reversal, never by mutating its facts.
 */
export const expenses = appSchema.table(
  'expenses',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id'),
    recurringTemplateId: uuid('recurring_template_id'),
    businessDate: text('business_date').notNull(),
    description: text('description').notNull(),
    category: text('category'),
    amount: money('amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    classification: text('classification').notNull(),
    settlementSource: text('settlement_source').notNull(),
    state: text('state').notNull().default('DRAFT'),
    approvalRequired: boolean('approval_required').notNull().default(true),
    requiredApproverCount: integer('required_approver_count').notNull().default(1),
    requiresStepUp: boolean('requires_step_up').notNull().default(false),
    version: integer('version').notNull().default(0),
    createdBy: uuid('created_by').notNull(),
    submittedBy: uuid('submitted_by'),
    returnedBy: uuid('returned_by'),
    rejectedBy: uuid('rejected_by'),
    approvedBy: uuid('approved_by'),
    postedBy: uuid('posted_by'),
    reversedBy: uuid('reversed_by'),
    submittedAt: utcTimestamp('submitted_at'),
    returnedAt: utcTimestamp('returned_at'),
    returnReason: text('return_reason'),
    rejectedAt: utcTimestamp('rejected_at'),
    rejectionReason: text('rejection_reason'),
    approvedAt: utcTimestamp('approved_at'),
    postedAt: utcTimestamp('posted_at'),
    reversedAt: utcTimestamp('reversed_at'),
    reversalReason: text('reversal_reason'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('expenses_tenant_id_id_uidx').on(table.tenantId, table.id),
    index('expenses_tenant_entity_station_date_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.stationId,
      table.businessDate,
    ),
    index('expenses_tenant_state_idx').on(table.tenantId, table.state),
    unique('expenses_recurring_template_business_date_uidx').on(
      table.tenantId,
      table.recurringTemplateId,
      table.businessDate,
    ),
    check('expenses_description_nonempty_ck', sql`btrim(${table.description}) <> ''`),
    check(
      'expenses_category_nonempty_ck',
      sql`${table.category} is null or btrim(${table.category}) <> ''`,
    ),
    check('expenses_amount_nonnegative_ck', sql`${table.amount} >= 0`),
    check('expenses_currency_ck', sql`${table.currency} = 'USD'`),
    check(
      'expenses_classification_ck',
      sql`${table.classification} in ('OPERATING_EXPENSE','DIRECT_INVENTORY_COST','RECURRING_FIXED_COST')`,
    ),
    check(
      'expenses_settlement_source_ck',
      sql`${table.settlementSource} in ('CASH','BANK','PAYABLE','REIMBURSEMENT')`,
    ),
    check(
      'expenses_state_ck',
      sql`${table.state} in ('DRAFT','SUBMITTED','RETURNED','APPROVED','REJECTED','POSTED','REVERSED')`,
    ),
    check('expenses_required_approvers_ck', sql`${table.requiredApproverCount} between 0 and 2`),
    check(
      'expenses_approval_policy_ck',
      sql`${table.approvalRequired} = (${table.requiredApproverCount} > 0)`,
    ),
    check(
      'expenses_post_provenance_ck',
      sql`${table.postedAt} is null or ${table.postedBy} is not null`,
    ),
    check(
      'expenses_reversal_provenance_ck',
      sql`${table.state} <> 'REVERSED' or (${table.reversedBy} is not null and ${table.reversedAt} is not null and btrim(coalesce(${table.reversalReason}, '')) <> '')`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'expenses_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'expenses_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'expenses_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recurringTemplateId],
      foreignColumns: [expenseRecurringTemplates.tenantId, expenseRecurringTemplates.id],
      name: 'expenses_recurring_template_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expenses_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.submittedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expenses_submitted_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.returnedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expenses_returned_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.rejectedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expenses_rejected_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expenses_approved_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.postedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expenses_posted_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reversedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expenses_reversed_by_fk',
    }),
  ],
);

/** Append-only recognition events consumed by management profitability. */
export const expenseRecognitionEvents = appSchema.table(
  'expense_recognition_events',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id'),
    expenseId: uuid('expense_id').notNull(),
    recognitionType: text('recognition_type').notNull(),
    recognitionDate: text('recognition_date').notNull(),
    classification: text('classification').notNull(),
    recognitionKind: text('recognition_kind').notNull(),
    amount: money('amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    effectiveAt: utcTimestamp('effective_at').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('expense_recognition_events_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('expense_recognition_events_expense_kind_uidx').on(
      table.tenantId,
      table.expenseId,
      table.recognitionType,
    ),
    index('expense_recognition_events_reporting_idx').on(
      table.tenantId,
      table.stationId,
      table.recognitionDate,
      table.effectiveAt,
    ),
    check(
      'expense_recognition_events_type_ck',
      sql`${table.recognitionType} in ('RECOGNITION','REVERSAL')`,
    ),
    check(
      'expense_recognition_events_classification_ck',
      sql`${table.classification} in ('OPERATING_EXPENSE','DIRECT_INVENTORY_COST','RECURRING_FIXED_COST')`,
    ),
    check('expense_recognition_events_currency_ck', sql`${table.currency} = 'USD'`),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'expense_recognition_events_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'expense_recognition_events_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.expenseId],
      foreignColumns: [expenses.tenantId, expenses.id],
      name: 'expense_recognition_events_expense_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expense_recognition_events_created_by_fk',
    }),
  ],
);
