import {
  foreignKey,
  integer,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { expenses, expenseCategories, expenseRecognitionMovements } from './expenses';
import { memberships } from './a1';
import { shifts, reconciliationRevisions } from './a3';
export const expenseVersions = appSchema.table(
  'expense_versions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    stationId: uuid('station_id').notNull(),
    expenseId: uuid('expense_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    previousVersionId: uuid('previous_version_id'),
    categoryId: uuid('category_id').notNull(),
    expenseDate: text('expense_date').notNull(),
    description: text('description').notNull(),
    payee: text('payee'),
    reference: text('reference'),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull(),
    shiftId: uuid('shift_id'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    lineageStatus: text('lineage_status').notNull(),
    changeReason: text('change_reason').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.tenantId, t.stationId, t.id),
    unique().on(t.tenantId, t.stationId, t.expenseId, t.id),
    unique().on(t.tenantId, t.stationId, t.expenseId, t.versionNumber),
    unique().on(t.tenantId, t.stationId, t.expenseId, t.previousVersionId),
    foreignKey({
      columns: [t.tenantId, t.stationId, t.expenseId],
      foreignColumns: [expenses.tenantId, expenses.stationId, expenses.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.stationId, t.expenseId, t.previousVersionId],
      foreignColumns: [t.tenantId, t.stationId, t.expenseId, t.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.stationId, t.shiftId],
      foreignColumns: [shifts.tenantId, shifts.stationId, shifts.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [expenseCategories.tenantId, expenseCategories.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
    }),
  ],
);
export const expenseRecognitionVersionSources = appSchema.table(
  'expense_recognition_version_sources',
  {
    tenantId: uuid('tenant_id').notNull(),
    stationId: uuid('station_id').notNull(),
    movementId: uuid('movement_id').notNull(),
    expenseId: uuid('expense_id').notNull(),
    expenseVersionId: uuid('expense_version_id').notNull(),
    lineageStatus: text('lineage_status').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.movementId] }),
    foreignKey({
      columns: [t.tenantId, t.movementId],
      foreignColumns: [expenseRecognitionMovements.tenantId, expenseRecognitionMovements.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.stationId, t.expenseId, t.expenseVersionId],
      foreignColumns: [
        expenseVersions.tenantId,
        expenseVersions.stationId,
        expenseVersions.expenseId,
        expenseVersions.id,
      ],
    }),
  ],
);
export const reconciliationExpenseVersionSources = appSchema.table(
  'reconciliation_expense_version_sources',
  {
    tenantId: uuid('tenant_id').notNull(),
    stationId: uuid('station_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    expenseId: uuid('expense_id').notNull(),
    expenseVersionId: uuid('expense_version_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.stationId, t.revisionId, t.expenseId] }),
    foreignKey({
      columns: [t.tenantId, t.stationId, t.revisionId],
      foreignColumns: [
        reconciliationRevisions.tenantId,
        reconciliationRevisions.stationId,
        reconciliationRevisions.id,
      ],
    }),
    foreignKey({
      columns: [t.tenantId, t.stationId, t.expenseId, t.expenseVersionId],
      foreignColumns: [
        expenseVersions.tenantId,
        expenseVersions.stationId,
        expenseVersions.expenseId,
        expenseVersions.id,
      ],
    }),
  ],
);
