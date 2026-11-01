import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

/**
 * The expense categories every company starts with, so a bill is filed where a person would look
 * for it (a repair under Maintenance, never under Utilities). Fixed costs such as rent and wages
 * are recurring costs and have their own categories; the reserved staff fuel category is created
 * by its own flow and is not here.
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  { code: 'MAINTENANCE', name: 'Maintenance', classification: 'OPERATING' },
  { code: 'CLEANING', name: 'Cleaning', classification: 'OPERATING' },
  { code: 'UTILITIES', name: 'Utilities', classification: 'OPERATING' },
  { code: 'SECURITY', name: 'Security', classification: 'OPERATING' },
  { code: 'FUEL_TRANSPORT', name: 'Fuel transport', classification: 'OPERATING' },
  { code: 'BANK_CHARGES', name: 'Bank charges', classification: 'OPERATING' },
  { code: 'OTHER', name: 'Other', classification: 'OPERATING' },
] as const;

type Executor = { execute(query: SQL): PromiseLike<unknown> };

/**
 * Adds any standard category a company does not have yet. Safe to run again: a category that
 * already exists (by code) is left exactly as it is, including a name the owner changed.
 */
export async function ensureDefaultExpenseCategories(
  transaction: Executor,
  scope: { tenantId: string; createdBy: string },
): Promise<void> {
  for (const category of DEFAULT_EXPENSE_CATEGORIES) {
    await transaction.execute(sql`
      insert into app.expense_categories (id, tenant_id, code, name, classification, created_by)
      values (${randomUUID()}, ${scope.tenantId}, ${category.code}, ${category.name},
              ${category.classification}, ${scope.createdBy})
      on conflict (tenant_id, code) do nothing
    `);
  }
}
