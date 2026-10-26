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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { legalEntities, memberships, stations } from './a1';
import { cashMovements } from './a6';
import { shifts } from './a3';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 20, scale: 4 });

/** Tenant-defined expense categories. No category is seeded: they are onboarding data. */
export const expenseCategories = appSchema.table(
  'expense_categories',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    classification: text('classification').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(0),
    createdBy: uuid('created_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('expense_categories_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('expense_categories_tenant_code_uidx').on(table.tenantId, table.code),
    check('expense_categories_code_nonempty_ck', sql`btrim(${table.code}) <> ''`),
    check('expense_categories_name_nonempty_ck', sql`btrim(${table.name}) <> ''`),
    check(
      'expense_categories_classification_ck',
      sql`${table.classification} in ('OPERATING','FIXED_COST','DIRECT_INVENTORY_COST')`,
    ),
    check('expense_categories_status_ck', sql`${table.status} in ('ACTIVE','INACTIVE')`),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expense_categories_created_by_fk',
    }),
  ],
);

/** Approval thresholds per legal entity. Absent thresholds fail closed (see ADR-018). */
export const expensePolicies = appSchema.table(
  'expense_policies',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stepUpThreshold: money('step_up_threshold'),
    secondApprovalThreshold: money('second_approval_threshold'),
    version: integer('version').notNull().default(0),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('expense_policies_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('expense_policies_tenant_legal_entity_uidx').on(table.tenantId, table.legalEntityId),
    check(
      'expense_policies_thresholds_ck',
      sql`(${table.stepUpThreshold} is null or ${table.stepUpThreshold} >= 0)
        and (${table.secondApprovalThreshold} is null or ${table.secondApprovalThreshold} > 0)
        and (${table.stepUpThreshold} is null or ${table.secondApprovalThreshold} is null or ${table.secondApprovalThreshold} >= ${table.stepUpThreshold})`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'expense_policies_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expense_policies_updated_by_fk',
    }),
  ],
);

/** Economic expense document. Settlement is a separate fact (expense_payments). */
export const expenses = appSchema.table(
  'expenses',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    shiftId: uuid('shift_id'),
    observedAt: utcTimestamp('observed_at'),
    currentVersionId: uuid('current_version_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    expenseDate: text('expense_date').notNull(),
    description: text('description').notNull(),
    payee: text('payee'),
    reference: text('reference'),
    /** How it was paid, said when entered: STATION_CASH, ECOCASH, BANK or CARD. Null on older rows. */
    paymentMethod: text('payment_method'),
    currency: text('currency').notNull().default('USD'),
    amount: money('amount').notNull(),
    state: text('state').notNull().default('SUBMITTED'),
    version: integer('version').notNull().default(0),
    requiredApprovals: integer('required_approvals').notNull().default(1),
    submittedBy: uuid('submitted_by').notNull(),
    submittedAt: utcTimestamp('submitted_at').notNull().defaultNow(),
    rejectedBy: uuid('rejected_by'),
    rejectedAt: utcTimestamp('rejected_at'),
    rejectionReason: text('rejection_reason'),
    postedBy: uuid('posted_by'),
    postedAt: utcTimestamp('posted_at'),
    reversedBy: uuid('reversed_by'),
    reversedAt: utcTimestamp('reversed_at'),
    reversalReason: text('reversal_reason'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('expenses_tenant_id_id_uidx').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.shiftId],
      foreignColumns: [shifts.tenantId, shifts.stationId, shifts.id],
      name: 'unified_expense_shift_fk',
    }),
    // The deferred current-version FK is SQL-owned (atomic cyclic identity/version creation).
    unique('expenses_tenant_station_id_id_uidx').on(table.tenantId, table.stationId, table.id),
    uniqueIndex('expenses_tenant_station_reference_uidx')
      .on(table.tenantId, table.stationId, table.reference)
      .where(sql`${table.reference} is not null and ${table.state} not in ('REJECTED','REVERSED')`),
    index('expenses_tenant_station_date_idx').on(
      table.tenantId,
      table.stationId,
      table.expenseDate,
    ),
    index('expenses_tenant_state_idx').on(table.tenantId, table.state),
    check('expenses_description_nonempty_ck', sql`btrim(${table.description}) <> ''`),
    check('expenses_currency_ck', sql`${table.currency} = 'USD'`),
    check('expenses_amount_positive_ck', sql`${table.amount} > 0`),
    check('expenses_required_approvals_ck', sql`${table.requiredApprovals} in (1,2)`),
    check(
      'expenses_state_ck',
      sql`${table.state} in ('SUBMITTED','APPROVED','REJECTED','POSTED','REVERSED')`,
    ),
    check(
      'expenses_rejection_provenance_ck',
      sql`${table.state} <> 'REJECTED' or (${table.rejectedBy} is not null and ${table.rejectedAt} is not null and btrim(coalesce(${table.rejectionReason}, '')) <> '')`,
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
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'expenses_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [expenseCategories.tenantId, expenseCategories.id],
      name: 'expenses_category_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.submittedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expenses_submitted_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.rejectedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expenses_rejected_by_fk',
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

/** Immutable private evidence metadata associated with one exact expense. */
export const expenseAttachments = appSchema.table(
  'expense_attachments',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    expenseId: uuid('expense_id').notNull(),
    objectKey: text('object_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    uploadedBy: uuid('uploaded_by').notNull(),
    uploadedAt: utcTimestamp('uploaded_at').notNull().defaultNow(),
  },
  (table) => [
    unique('expense_attachments_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('expense_attachments_tenant_object_key_uidx').on(table.tenantId, table.objectKey),
    index('expense_attachments_expense_idx').on(table.tenantId, table.stationId, table.expenseId),
    check('expense_attachments_filename_nonempty_ck', sql`btrim(${table.fileName}) <> ''`),
    check(
      'expense_attachments_content_type_ck',
      sql`${table.contentType} in (
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )`,
    ),
    check(
      'expense_attachments_byte_size_ck',
      sql`${table.byteSize} > 0 and ${table.byteSize} <= 10485760`,
    ),
    check('expense_attachments_sha256_ck', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'expense_attachments_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.expenseId],
      foreignColumns: [expenses.tenantId, expenses.stationId, expenses.id],
      name: 'expense_attachments_expense_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.uploadedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expense_attachments_uploaded_by_fk',
    }),
  ],
);

/** Append-only approval decisions, one per actor per expense. */
export const expenseApprovals = appSchema.table(
  'expense_approvals',
  {
    id: id(),
    tenantId: tenantId(),
    expenseId: uuid('expense_id').notNull(),
    decision: text('decision').notNull(),
    reason: text('reason'),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    decidedAt: utcTimestamp('decided_at').notNull().defaultNow(),
  },
  (table) => [
    unique('expense_approvals_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('expense_approvals_expense_actor_uidx').on(
      table.tenantId,
      table.expenseId,
      table.actorMembershipId,
    ),
    index('expense_approvals_expense_idx').on(table.tenantId, table.expenseId),
    check('expense_approvals_decision_ck', sql`${table.decision} in ('APPROVED','REJECTED')`),
    check(
      'expense_approvals_reject_reason_ck',
      sql`${table.decision} <> 'REJECTED' or btrim(coalesce(${table.reason}, '')) <> ''`,
    ),
    foreignKey({
      columns: [table.tenantId, table.expenseId],
      foreignColumns: [expenses.tenantId, expenses.id],
      name: 'expense_approvals_expense_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expense_approvals_actor_fk',
    }),
  ],
);

export const recurringCostTemplates = appSchema.table(
  'recurring_cost_templates',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    name: text('name').notNull(),
    frequency: text('frequency').notNull().default('MONTHLY'),
    currency: text('currency').notNull().default('USD'),
    amount: money('amount').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    status: text('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(0),
    createdBy: uuid('created_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('recurring_cost_templates_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('recurring_cost_templates_tenant_station_name_uidx').on(
      table.tenantId,
      table.stationId,
      table.name,
    ),
    check('recurring_cost_templates_name_nonempty_ck', sql`btrim(${table.name}) <> ''`),
    check('recurring_cost_templates_frequency_ck', sql`${table.frequency} = 'MONTHLY'`),
    check('recurring_cost_templates_currency_ck', sql`${table.currency} = 'USD'`),
    check('recurring_cost_templates_amount_positive_ck', sql`${table.amount} > 0`),
    check('recurring_cost_templates_status_ck', sql`${table.status} in ('ACTIVE','INACTIVE')`),
    check(
      'recurring_cost_templates_dates_ck',
      sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'recurring_cost_templates_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [expenseCategories.tenantId, expenseCategories.id],
      name: 'recurring_cost_templates_category_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'recurring_cost_templates_created_by_fk',
    }),
  ],
);

/** The obligation for one calendar month. Recognition and payment are separate facts. */
export const recurringCostPeriods = appSchema.table(
  'recurring_cost_periods',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    templateId: uuid('template_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    currency: text('currency').notNull().default('USD'),
    amount: money('amount').notNull(),
    version: integer('version').notNull().default(0),
    generatedBy: uuid('generated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('recurring_cost_periods_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('recurring_cost_periods_template_start_uidx').on(
      table.tenantId,
      table.templateId,
      table.periodStart,
    ),
    index('recurring_cost_periods_station_idx').on(
      table.tenantId,
      table.stationId,
      table.periodStart,
    ),
    check('recurring_cost_periods_currency_ck', sql`${table.currency} = 'USD'`),
    check('recurring_cost_periods_amount_positive_ck', sql`${table.amount} > 0`),
    check('recurring_cost_periods_dates_ck', sql`${table.periodEnd} >= ${table.periodStart}`),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'recurring_cost_periods_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.templateId],
      foreignColumns: [recurringCostTemplates.tenantId, recurringCostTemplates.id],
      name: 'recurring_cost_periods_template_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [expenseCategories.tenantId, expenseCategories.id],
      name: 'recurring_cost_periods_category_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.generatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'recurring_cost_periods_generated_by_fk',
    }),
  ],
);

/** One daily recognition of a period obligation. Never created by a payment. */
export const recurringCostRecognitions = appSchema.table(
  'recurring_cost_recognitions',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    periodId: uuid('period_id').notNull(),
    recognitionDate: text('recognition_date').notNull(),
    currency: text('currency').notNull().default('USD'),
    amount: money('amount').notNull(),
    state: text('state').notNull().default('RECOGNIZED'),
    recognizedBy: uuid('recognized_by').notNull(),
    recognizedAt: utcTimestamp('recognized_at').notNull().defaultNow(),
    reversedBy: uuid('reversed_by'),
    reversedAt: utcTimestamp('reversed_at'),
    reversalReason: text('reversal_reason'),
    adjustmentOfId: uuid('adjustment_of_id'),
  },
  (table) => [
    unique('recurring_cost_recognitions_tenant_id_id_uidx').on(table.tenantId, table.id),
    uniqueIndex('recurring_cost_recognitions_active_period_date_uidx')
      .on(table.tenantId, table.periodId, table.recognitionDate)
      .where(sql`${table.state} = 'RECOGNIZED'`),
    check('recurring_cost_recognitions_currency_ck', sql`${table.currency} = 'USD'`),
    check('recurring_cost_recognitions_amount_positive_ck', sql`${table.amount} > 0`),
    check('recurring_cost_recognitions_state_ck', sql`${table.state} in ('RECOGNIZED','REVERSED')`),
    check(
      'recurring_cost_recognitions_reversal_provenance_ck',
      sql`${table.state} <> 'REVERSED' or (${table.reversedBy} is not null and ${table.reversedAt} is not null and btrim(coalesce(${table.reversalReason}, '')) <> '')`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'recurring_cost_recognitions_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.periodId],
      foreignColumns: [recurringCostPeriods.tenantId, recurringCostPeriods.id],
      name: 'recurring_cost_recognitions_period_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recognizedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'recurring_cost_recognitions_recognized_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reversedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'recurring_cost_recognitions_reversed_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.adjustmentOfId],
      foreignColumns: [table.tenantId, table.id],
      name: 'recurring_cost_recognitions_adjustment_of_fk',
    }),
  ],
);

/**
 * Settlement of an expense or recurring-cost obligation. It records how the obligation was
 * settled; it never recognizes cost and never writes cash or bank ledgers.
 */
export const expensePayments = appSchema.table(
  'expense_payments',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    expenseId: uuid('expense_id'),
    recurringPeriodId: uuid('recurring_period_id'),
    paymentDate: text('payment_date').notNull(),
    currency: text('currency').notNull().default('USD'),
    amount: money('amount').notNull(),
    settlementSource: text('settlement_source').notNull(),
    cashMovementId: uuid('cash_movement_id'),
    externalReference: text('external_reference'),
    state: text('state').notNull().default('RECORDED'),
    recordedBy: uuid('recorded_by').notNull(),
    recordedAt: utcTimestamp('recorded_at').notNull().defaultNow(),
    reversedBy: uuid('reversed_by'),
    reversedAt: utcTimestamp('reversed_at'),
    reversalReason: text('reversal_reason'),
  },
  (table) => [
    unique('expense_payments_tenant_id_id_uidx').on(table.tenantId, table.id),
    uniqueIndex('expense_payments_cash_movement_uidx')
      .on(table.tenantId, table.cashMovementId)
      .where(sql`${table.cashMovementId} is not null`),
    index('expense_payments_expense_idx').on(table.tenantId, table.expenseId, table.state),
    index('expense_payments_period_idx').on(table.tenantId, table.recurringPeriodId, table.state),
    check('expense_payments_currency_ck', sql`${table.currency} = 'USD'`),
    check('expense_payments_amount_positive_ck', sql`${table.amount} > 0`),
    check(
      'expense_payments_source_ck',
      sql`${table.settlementSource} in ('CASH','BANK','REIMBURSEMENT','MOBILE_MONEY')`,
    ),
    check('expense_payments_state_ck', sql`${table.state} in ('RECORDED','REVERSED')`),
    check(
      'expense_payments_single_target_ck',
      sql`(${table.expenseId} is not null) <> (${table.recurringPeriodId} is not null)`,
    ),
    check(
      'expense_payments_reference_ck',
      sql`${table.cashMovementId} is not null or btrim(coalesce(${table.externalReference}, '')) <> ''`,
    ),
    check(
      'expense_payments_cash_link_ck',
      sql`${table.cashMovementId} is null or ${table.settlementSource} = 'CASH'`,
    ),
    check(
      'expense_payments_reversal_provenance_ck',
      sql`${table.state} <> 'REVERSED' or (${table.reversedBy} is not null and ${table.reversedAt} is not null and btrim(coalesce(${table.reversalReason}, '')) <> '')`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'expense_payments_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.expenseId],
      foreignColumns: [expenses.tenantId, expenses.id],
      name: 'expense_payments_expense_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recurringPeriodId],
      foreignColumns: [recurringCostPeriods.tenantId, recurringCostPeriods.id],
      name: 'expense_payments_period_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.cashMovementId],
      foreignColumns: [cashMovements.tenantId, cashMovements.id],
      name: 'expense_payments_cash_movement_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expense_payments_recorded_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reversedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expense_payments_reversed_by_fk',
    }),
  ],
);

/**
 * Append-only recognition ledger: the source for operating-expense and fixed-cost reporting.
 * Rows are posted expenses and daily recurring-cost recognitions, plus their reversals.
 */
export const expenseRecognitionMovements = appSchema.table(
  'expense_recognition_movements',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    classification: text('classification').notNull(),
    movementType: text('movement_type').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    recognitionDate: text('recognition_date').notNull(),
    currency: text('currency').notNull().default('USD'),
    amount: money('amount').notNull(),
    reversalOfId: uuid('reversal_of_id'),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    postedAt: utcTimestamp('posted_at').notNull().defaultNow(),
  },
  (table) => [
    unique('expense_recognition_movements_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('expense_recognition_movements_source_uidx').on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
      table.movementType,
    ),
    index('expense_recognition_movements_station_date_idx').on(
      table.tenantId,
      table.stationId,
      table.recognitionDate,
    ),
    check(
      'expense_recognition_movements_classification_ck',
      sql`${table.classification} in ('OPERATING','FIXED_COST')`,
    ),
    check(
      'expense_recognition_movements_type_ck',
      sql`${table.movementType} in ('RECOGNITION','REVERSAL')`,
    ),
    check(
      'expense_recognition_movements_source_type_ck',
      sql`${table.sourceType} in ('EXPENSE','RECURRING_COST_RECOGNITION')`,
    ),
    check('expense_recognition_movements_currency_ck', sql`${table.currency} = 'USD'`),
    check('expense_recognition_movements_amount_positive_ck', sql`${table.amount} > 0`),
    check(
      'expense_recognition_movements_reversal_ck',
      sql`(${table.movementType} = 'REVERSAL') = (${table.reversalOfId} is not null)`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'expense_recognition_movements_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.categoryId],
      foreignColumns: [expenseCategories.tenantId, expenseCategories.id],
      name: 'expense_recognition_movements_category_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reversalOfId],
      foreignColumns: [table.tenantId, table.id],
      name: 'expense_recognition_movements_reversal_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'expense_recognition_movements_actor_fk',
    }),
  ],
);
