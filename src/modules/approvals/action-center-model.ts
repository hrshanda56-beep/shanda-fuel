import { formatUsd } from '../../design-system/formatters';
import { ExactDecimal } from '../../platform/domain/primitives';

/** What one part of the Action Center could tell us. */
export type Section<T> =
  | { status: 'ok'; value: T }
  /** The person's role does not include this area; it is simply not shown. */
  | { status: 'restricted' }
  /** The check failed; shown as "could not be checked", never as zero. */
  | { status: 'unavailable' };

export type ReconciliationWaiting = {
  id: string;
  businessDate: string;
  submittedByMe: boolean;
};
export type RevaluationWaiting = { id: string; requestedByMe: boolean };

export type ActionCenterFacts = {
  stationId: string;
  /** `soleApprover`: nobody else could approve, so the person may approve their own work. */
  reconciliations: Section<{ rows: readonly ReconciliationWaiting[]; soleApprover: boolean }>;
  revaluations: Section<{ rows: readonly RevaluationWaiting[]; soleApprover: boolean }>;
  cash: Section<{ collectedButUnbanked: string; pendingBankConfirmation: string }>;
  settlements: Section<{ toMatch: number; exceptions: number; unmatchedPayments: number }>;
  suppliers: Section<{ overdueSuppliers: number; overdueTotal: string }>;
  customers: Section<{ nearLimit: number; overLimit: number }>;
};

export type ActionArea = 'Approvals' | 'Banking' | 'Settlements' | 'Payables' | 'Receivables';

export type ActionItem = {
  id: string;
  area: ActionArea;
  title: string;
  detail: string;
  href: string;
  tone: 'attention' | 'info';
};

export type ActionCenter = {
  items: readonly ActionItem[];
  /** Areas that could not be checked, so "all clear" is never claimed falsely. */
  unavailable: readonly string[];
};

/**
 * A credit account counts as "near its limit" from this share of the limit owed. This is a
 * reminder threshold, not a credit policy: it never blocks a sale. Replace it with the client's
 * own figure once they give one.
 */
export const NEAR_LIMIT_PERCENT = 80;

export type CreditUse = 'ok' | 'near' | 'over';

/** Exact comparison of what is owed against the limit. No limit (or a zero limit) is not judged. */
export function classifyCreditUse(balance: string | null, creditLimit: string | null): CreditUse {
  if (balance === null || creditLimit === null) return 'ok';
  const owed = new ExactDecimal(balance).value;
  const limit = new ExactDecimal(creditLimit).value;
  if (!limit.gt(0)) return 'ok';
  if (owed.gt(limit)) return 'over';
  return owed.mul(100).gte(limit.mul(NEAR_LIMIT_PERCENT)) ? 'near' : 'ok';
}

const isPositive = (value: string) => /^\d+(?:\.\d+)?$/.test(value) && !/^0+(?:\.0+)?$/.test(value);
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** Turn raw facts into an ordered list of work, most urgent first. Pure and exact. */
export function buildActionCenter(facts: ActionCenterFacts): ActionCenter {
  const items: ActionItem[] = [];
  const unavailable: string[] = [];
  const station = `/stations/${encodeURIComponent(facts.stationId)}`;

  if (facts.reconciliations.status === 'unavailable') unavailable.push('Reconciliations');
  if (facts.reconciliations.status === 'ok') {
    for (const row of facts.reconciliations.value.rows) {
      // Someone else must sign off, unless there is no one else who could.
      const blocked = row.submittedByMe && !facts.reconciliations.value.soleApprover;
      items.push({
        id: `reconciliation-${row.id}`,
        area: 'Approvals',
        title: `Reconciliation for ${row.businessDate} is waiting for approval`,
        detail: blocked
          ? 'You submitted this, so someone else needs to approve it.'
          : 'Review and approve or return it.',
        href: `${station}/reconciliations/${encodeURIComponent(row.id)}/review`,
        tone: 'attention',
      });
    }
  }

  if (facts.revaluations.status === 'unavailable') unavailable.push('Cost revaluations');
  if (facts.revaluations.status === 'ok') {
    for (const row of facts.revaluations.value.rows) {
      const blocked = row.requestedByMe && !facts.revaluations.value.soleApprover;
      items.push({
        id: `revaluation-${row.id}`,
        area: 'Approvals',
        title: 'A stock cost revaluation is waiting for approval',
        detail: blocked
          ? 'You requested this, so someone else needs to approve it.'
          : 'Review the cost impact before approving.',
        href: `/inventory/valuation/revaluations/${encodeURIComponent(row.id)}`,
        tone: 'attention',
      });
    }
  }

  if (facts.cash.status === 'unavailable') unavailable.push('Cash and banking');
  if (facts.cash.status === 'ok') {
    const { collectedButUnbanked, pendingBankConfirmation } = facts.cash.value;
    if (isPositive(pendingBankConfirmation)) {
      items.push({
        id: 'cash-pending-confirmation',
        area: 'Banking',
        title: `${formatUsd(pendingBankConfirmation)} of deposits awaiting bank confirmation`,
        detail: 'Confirm each deposit against the bank record.',
        href: `${station}/cash`,
        tone: 'attention',
      });
    }
    if (isPositive(collectedButUnbanked)) {
      items.push({
        id: 'cash-unbanked',
        area: 'Banking',
        title: `${formatUsd(collectedButUnbanked)} collected but not yet banked`,
        detail: 'Record a deposit once the cash is taken to the bank.',
        href: `${station}/cash`,
        tone: 'info',
      });
    }
  }

  if (facts.settlements.status === 'unavailable') unavailable.push('Provider settlements');
  if (facts.settlements.status === 'ok') {
    const { exceptions, toMatch, unmatchedPayments } = facts.settlements.value;
    if (exceptions > 0) {
      items.push({
        id: 'settlement-exceptions',
        area: 'Settlements',
        title: `${exceptions} provider ${plural(exceptions, 'settlement has', 'settlements have')} a difference`,
        detail: 'The settled amount does not match what was expected.',
        href: `${station}/settlements`,
        tone: 'attention',
      });
    }
    if (toMatch > 0) {
      items.push({
        id: 'settlement-to-match',
        area: 'Settlements',
        title: `${toMatch} provider ${plural(toMatch, 'settlement needs', 'settlements need')} matching`,
        detail: 'Match them to the card and mobile payments they cover.',
        href: `${station}/settlements`,
        tone: 'info',
      });
    }
    if (unmatchedPayments > 0) {
      items.push({
        id: 'settlement-unmatched-payments',
        area: 'Settlements',
        title: `${unmatchedPayments} ${plural(unmatchedPayments, 'payment is', 'payments are')} not matched to a settlement`,
        detail: 'Card and mobile payments waiting for their provider settlement.',
        href: `${station}/settlements`,
        tone: 'info',
      });
    }
  }

  if (facts.suppliers.status === 'unavailable') unavailable.push('Supplier payables');
  if (facts.suppliers.status === 'ok' && facts.suppliers.value.overdueSuppliers > 0) {
    const { overdueSuppliers, overdueTotal } = facts.suppliers.value;
    items.push({
      id: 'suppliers-overdue',
      area: 'Payables',
      title: `${formatUsd(overdueTotal)} overdue to ${overdueSuppliers} ${plural(overdueSuppliers, 'supplier', 'suppliers')}`,
      detail: 'Past the due date on supplier invoices.',
      href: '/suppliers',
      tone: 'attention',
    });
  }

  if (facts.customers.status === 'unavailable') unavailable.push('Customer credit');
  if (facts.customers.status === 'ok') {
    const { nearLimit, overLimit } = facts.customers.value;
    if (overLimit > 0) {
      items.push({
        id: 'customers-over-limit',
        area: 'Receivables',
        title: `${overLimit} ${plural(overLimit, 'customer is', 'customers are')} over their credit limit`,
        detail: 'They owe more than their agreed limit.',
        href: '/customers',
        tone: 'attention',
      });
    }
    if (nearLimit > 0) {
      items.push({
        id: 'customers-near-limit',
        area: 'Receivables',
        title: `${nearLimit} ${plural(nearLimit, 'customer is', 'customers are')} near their credit limit`,
        detail: `They owe ${NEAR_LIMIT_PERCENT}% or more of their agreed limit.`,
        href: '/customers',
        tone: 'info',
      });
    }
  }

  // Attention first, otherwise keep the order above.
  const ordered = [...items].sort(
    (a, b) => Number(b.tone === 'attention') - Number(a.tone === 'attention'),
  );
  return { items: ordered, unavailable };
}

export const ACTION_AREAS: readonly ActionArea[] = [
  'Approvals',
  'Banking',
  'Settlements',
  'Payables',
  'Receivables',
];
