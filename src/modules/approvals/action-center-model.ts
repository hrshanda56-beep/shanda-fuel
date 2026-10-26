import { formatUsd } from '../../design-system/formatters';
import { ExactDecimal } from '../../platform/domain/primitives';
import {
  DEFAULT_ALERT_SETTINGS,
  buildOperationsAlerts,
  type AlertSettings,
  type TankAlertFacts,
} from './operations-alerts';
import {
  DEFAULT_EXTRA_ALERT_SETTINGS,
  buildExtraAlerts,
  type ExtraAlertFacts,
  type ExtraAlertSettings,
} from './extra-alerts';

/** What one part of the Action Center could tell us. */
export type Section<T> =
  | { status: 'ok'; value: T }
  /** The person's role does not include this area; it is simply not shown. */
  | { status: 'restricted' }
  /** The check failed; shown as "could not be checked", never as zero. */
  | { status: 'unavailable' };

export type ReconciliationWaiting = {
  id: string;
  businessDayId: string;
  /** A reconciliation can be for the whole day, with no single shift. */
  shiftId: string | null;
  businessDate: string;
  submittedByMe: boolean;
};
export type RevaluationWaiting = { id: string; requestedByMe: boolean };
export type PriceWaiting = {
  id: string;
  productName: string;
  unitPrice: string;
  requestedByMe: boolean;
};
export type OrderWaiting = {
  id: string;
  orderNumber: string;
  supplierName: string;
  submittedByMe: boolean;
};
/** Supplier invoices and credit notes entered but not yet posted, counted per supplier. */
export type InvoiceWaiting = { supplierId: string; documentType: string; count: number };

export type ActionCenterFacts = {
  tenantId: string;
  stationId: string;
  /** `soleApprover`: nobody else could approve, so the person may approve their own work. */
  reconciliations: Section<{ rows: readonly ReconciliationWaiting[]; soleApprover: boolean }>;
  revaluations: Section<{ rows: readonly RevaluationWaiting[]; soleApprover: boolean }>;
  prices?: Section<{ rows: readonly PriceWaiting[]; soleApprover: boolean }>;
  orders?: Section<{ rows: readonly OrderWaiting[]; soleApprover: boolean }>;
  invoices?: Section<{ rows: readonly InvoiceWaiting[] }>;
  cash: Section<{ collectedButUnbanked: string; pendingBankConfirmation: string }>;
  settlements: Section<{
    toMatch: number;
    exceptions: number;
    unmatchedPayments: number;
    /** Business dates of card and mobile payments not yet matched to a settlement. */
    unmatchedDates: readonly string[];
  }>;
  suppliers: Section<{
    overdueSuppliers: number;
    overdueTotal: string;
    dueTodayTotal: string;
    dueSoonTotal: string;
    dueSoonDays: number;
    /** Suppliers owed more than their credit limit, and those using 80% or more of it. */
    overLimit: number;
    nearLimit: number;
  }>;
  customers: Section<{ nearLimit: number; overLimit: number }>;
  /** Station-local today, used to age the dated items below. Null when it could not be read. */
  today: string | null;
  reports: Section<{
    unsubmittedDates: readonly string[];
    closedUnreconciledDates?: readonly string[];
    cashShortages: readonly { businessDate: string; amount: string }[];
  }>;
  stock: Section<{ tanks: readonly TankAlertFacts[] }>;
  /** The reminder thresholds in force. Defaults apply until the organisation sets its own. */
  settings?: AlertSettings;
  /** Unbanked cash, high expense, below-price sale, short delivery, approved-information change. */
  extra?: Section<ExtraAlertFacts>;
  extraSettings?: ExtraAlertSettings;
};

export type ActionArea = 'Approvals' | 'Banking' | 'Settlements' | 'Payables' | 'Receivables';

export type ActionItem = {
  id: string;
  /** Operations alerts sit beside the finance areas and have no tile of their own. */
  area: ActionArea | 'Operations';
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

/**
 * The management review screen takes its whole scope from the address, so the link must carry
 * the organisation, station, business day and shift, or the screen has nothing to open.
 */
function reconciliationReviewHref(
  facts: Pick<ActionCenterFacts, 'tenantId' | 'stationId'>,
  row: ReconciliationWaiting,
): string {
  const params = new URLSearchParams({
    tenantId: facts.tenantId,
    stationId: facts.stationId,
    businessDayId: row.businessDayId,
  });
  if (row.shiftId) params.set('shiftId', row.shiftId);
  return `/operations/reconciliations/${encodeURIComponent(row.id)}/review?${params}`;
}

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
        href: reconciliationReviewHref(facts, row),
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

  if (facts.prices?.status === 'unavailable') unavailable.push('Price changes');
  if (facts.prices?.status === 'ok') {
    for (const row of facts.prices.value.rows) {
      const blocked = row.requestedByMe && !facts.prices.value.soleApprover;
      items.push({
        id: `price-${row.id}`,
        area: 'Approvals',
        title: `A new ${row.productName} price of ${formatUsd(row.unitPrice)} is waiting for approval`,
        detail: blocked
          ? 'You requested this, so someone else needs to approve it.'
          : 'Check the price, then approve it so it can be used.',
        href: '/settings',
        tone: 'attention',
      });
    }
  }

  if (facts.orders?.status === 'unavailable') unavailable.push('Purchase orders');
  if (facts.orders?.status === 'ok') {
    for (const row of facts.orders.value.rows) {
      const blocked = row.submittedByMe && !facts.orders.value.soleApprover;
      items.push({
        id: `order-${row.id}`,
        area: 'Approvals',
        title: `Order ${row.orderNumber} from ${row.supplierName} is waiting for approval`,
        detail: blocked
          ? 'You sent this, so someone else needs to approve it.'
          : 'Review the fuel and prices before approving.',
        href: `/purchasing/${encodeURIComponent(row.id)}`,
        tone: 'attention',
      });
    }
  }

  if (facts.invoices?.status === 'unavailable') unavailable.push('Supplier invoices');
  if (facts.invoices?.status === 'ok') {
    for (const row of facts.invoices.value.rows) {
      const noun = row.documentType === 'INVOICE' ? 'invoice' : 'credit note';
      items.push({
        id: `invoice-${row.supplierId}-${row.documentType}`,
        area: 'Payables',
        title: `${row.count} supplier ${plural(row.count, noun, `${noun}s`)} not yet posted`,
        detail: 'Nothing is owed until it is posted. Open the supplier to post it.',
        href: `/suppliers/${encodeURIComponent(row.supplierId)}`,
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

  if (facts.suppliers.status === 'ok') {
    const { dueTodayTotal, dueSoonTotal, dueSoonDays } = facts.suppliers.value;
    if (isPositive(dueTodayTotal)) {
      items.push({
        id: 'suppliers-due-today',
        area: 'Payables',
        title: `${formatUsd(dueTodayTotal)} falls due to suppliers today`,
        detail: 'Supplier invoices with today as their due date.',
        href: '/suppliers',
        tone: 'attention',
      });
    }
    if (isPositive(dueSoonTotal)) {
      items.push({
        id: 'suppliers-due-soon',
        area: 'Payables',
        title: `${formatUsd(dueSoonTotal)} falls due to suppliers in the next ${dueSoonDays} days`,
        detail: 'Plan the payment so the invoices are not late.',
        href: '/suppliers',
        tone: 'info',
      });
    }
  }

  if (facts.suppliers.status === 'ok') {
    const { overLimit, nearLimit } = facts.suppliers.value;
    if (overLimit > 0) {
      items.push({
        id: 'suppliers-over-limit',
        area: 'Payables',
        title: `${overLimit} ${plural(overLimit, 'supplier is', 'suppliers are')} owed more than the credit limit`,
        detail: 'What we owe is above the limit agreed with the supplier.',
        href: '/suppliers',
        tone: 'attention',
      });
    }
    if (nearLimit > 0) {
      items.push({
        id: 'suppliers-near-limit',
        area: 'Payables',
        title: `${nearLimit} ${plural(nearLimit, 'supplier is', 'suppliers are')} close to the credit limit`,
        detail: 'Eighty percent or more of the limit is used.',
        href: '/suppliers',
        tone: 'info',
      });
    }
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

  if (facts.reports.status === 'unavailable') unavailable.push('Daily reports');
  if (facts.stock.status === 'unavailable') unavailable.push('Stock');
  if (facts.today) {
    const reports = facts.reports.status === 'ok' ? facts.reports.value : null;
    const stock = facts.stock.status === 'ok' ? facts.stock.value : null;
    const settlements = facts.settlements.status === 'ok' ? facts.settlements.value : null;
    for (const alert of buildOperationsAlerts(
      {
        today: facts.today,
        unsubmittedDates: reports?.unsubmittedDates ?? [],
        closedUnreconciledDates: reports?.closedUnreconciledDates ?? [],
        cashShortages: reports?.cashShortages ?? [],
        tanks: stock?.tanks ?? [],
        unsettledPaymentDates: settlements?.unmatchedDates ?? [],
      },
      facts.settings ?? DEFAULT_ALERT_SETTINGS,
      { id: facts.stationId },
    )) {
      items.push({ ...alert, area: 'Operations' });
    }
  }

  if (facts.extra?.status === 'unavailable') unavailable.push('Cash, expense and delivery checks');
  if (facts.extra?.status === 'ok') {
    for (const alert of buildExtraAlerts(
      facts.extra.value,
      facts.extraSettings ?? DEFAULT_EXTRA_ALERT_SETTINGS,
      { id: facts.stationId },
    )) {
      items.push({ ...alert, area: 'Operations' });
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
