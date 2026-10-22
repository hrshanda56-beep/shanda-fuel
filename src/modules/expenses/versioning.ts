import { AppError } from '../../platform/errors';
import { positiveMoney } from './domain';
export type ExpenseVersionFacts = Readonly<{
  expenseId: string;
  categoryId: string;
  expenseDate: string;
  description: string;
  payee: string | null;
  reference: string | null;
  amount: string;
  currency: 'USD';
  shiftId: string | null;
  observedAt: string | null;
}>;
export function expenseVersionSnapshot(
  facts: ExpenseVersionFacts,
  provenance: {
    versionNumber: number;
    previousVersionId: string | null;
    actorId: string;
    reason: string;
    lineage: 'COMPLETE' | 'LEGACY_SNAPSHOT';
  },
) {
  if (
    !Number.isInteger(provenance.versionNumber) ||
    provenance.versionNumber < 1 ||
    (provenance.versionNumber === 1) !== (provenance.previousVersionId === null) ||
    !provenance.actorId.trim() ||
    !provenance.reason.trim()
  )
    throw new AppError('VALIDATION_FAILED', 'Expense version provenance is incomplete');
  if (!/^\d{1,16}(\.\d{1,4})?$/.test(facts.amount))
    throw new AppError('VALIDATION_FAILED', 'Exact expense amount required');
  positiveMoney(facts.amount);
  if (Boolean(facts.shiftId) !== Boolean(facts.observedAt))
    throw new AppError('VALIDATION_FAILED', 'Shift expense requires its observation time');
  return Object.freeze({ ...facts, ...provenance });
}
export function assertExpenseCorrectionAllowed(input: {
  state: string;
  approvals: number;
  payments: number;
  submittedReportUses: number;
  expectedVersionId: string;
  currentVersionId: string;
}) {
  if (input.expectedVersionId !== input.currentVersionId)
    throw new AppError('CONFLICT', 'Expense changed; reload before correcting');
  if (
    input.state !== 'SUBMITTED' ||
    input.approvals !== 0 ||
    input.payments !== 0 ||
    input.submittedReportUses !== 0
  )
    throw new AppError(
      'CONFLICT',
      'Expense is already in review or financially effective; use its controlled rejection or reversal workflow',
    );
}
