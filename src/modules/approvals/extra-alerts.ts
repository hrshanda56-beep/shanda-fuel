import { formatLitres, formatUsd } from '../../design-system/formatters';
import { ExactDecimal } from '../../platform/domain/primitives';
import { paymentNeedsProofFlag } from '../creditors/payment-proof';
import type { CustomerOverLimitFact, CustomerOverdueFact } from '../customers/alert-facts';
import { daysBetween, type OperationsAlert } from './operations-alerts';

/**
 * Alerts added for the client brief (S18): unbanked cash that has waited too long, a high
 * expense, a sale below the approved price, a short delivery and a change to approved
 * information. Pure and exact; the server code that reads the facts is in
 * `extra-alert-facts.ts`.
 *
 * Customer alerts (S18): "overdue" has no per-customer credit period to measure against yet, so
 * it uses one working default for everyone (`customerOverdueDays`, awaiting owner confirmation)
 * applied to the oldest unpaid charge (the ageing rule: payments clear the oldest charge first).
 * Over-limit names the account; the Action Center also shows a count of customers over their limit.
 * Customer credit is organisation-wide (ADR-017), so these appear at every station.
 */

/**
 * Placeholder reminder thresholds. AWAITING OWNER CONFIRMATION: these are working defaults, not
 * the client's figures. They are kept in code (not the Settings > Reminders table) until the
 * owner confirms the numbers and a settings change is approved; none of them blocks any work.
 */
export type ExtraAlertSettings = Readonly<{
  /** Cash collected but not banked after this many days is flagged. */
  unbankedCashDays: number;
  /** An expense at or above this amount (USD) is flagged for a look. */
  highExpenseAmount: string;
  /** A delivery that is short by at least this many litres is flagged. */
  deliveryShortageMinimumLitres: string;
  /** How far back dated items are looked for. */
  lookbackDays: number;
  /** Credit days for a customer whose account names none. Past a customer's own days, they are overdue. */
  customerOverdueDays: number;
}>;

export const DEFAULT_EXTRA_ALERT_SETTINGS: ExtraAlertSettings = {
  unbankedCashDays: 2,
  highExpenseAmount: '500.00',
  deliveryShortageMinimumLitres: '20',
  lookbackDays: 14,
  customerOverdueDays: 30,
};

export type ExtraAlertFacts = Readonly<{
  /** Station-local today. */
  today: string;
  unbankedCash: readonly { reference: string; businessDate: string; amount: string }[] | null;
  expenses:
    readonly { id: string; expenseDate: string; description: string; amount: string }[] | null;
  belowPriceSales:
    | readonly {
        businessDate: string;
        product: string;
        soldPrice: string;
        approvedPrice: string;
        litres: string;
      }[]
    | null;
  shortDeliveries:
    | readonly {
        id: string;
        businessDate: string;
        product: string;
        deliveryNote: string;
        shortLitres: string;
      }[]
    | null;
  /** Count of changes to approved records in the look-back window. Null when not permitted. */
  approvedInformationChanges: number | null;
  /**
   * Submitted or posted supplier payments with no proof file, newest first. The rule (USD 1000 or
   * more) is applied again here, so a caller that passes smaller payments is still safe. Null
   * when the person may not see supplier payments; absent when the caller does not load it.
   */
  unprovenSupplierPayments?:
    | readonly {
        id: string;
        supplierId: string;
        supplierName: string;
        paymentDate: string;
        reference: string;
        amount: string;
      }[]
    | null;
  /**
   * Open shifts with tanks that have no dip reading when one is due: at the start (30 minutes
   * after opening) or at the close (from 30 minutes before the shift ends). Null when the person
   * may not see inventory; absent when the caller does not load it.
   */
  dipReminders?:
    | readonly {
        shiftId: string;
        kind: 'OPENING' | 'CLOSING';
        tankCodes: readonly string[];
      }[]
    | null;
  /** Credit accounts with an unpaid charge. Null when the person may not see customer accounts. */
  customerOverdue?: readonly CustomerOverdueFact[] | null;
  /** Accounts over their limit (staff benefit: over the monthly limit). Null when not permitted. */
  customerOverLimit?: readonly CustomerOverLimitFact[] | null;
}>;

/**
 * Audit event codes that mean something already approved or posted was changed, corrected or
 * reversed. A curated list: AWAITING OWNER CONFIRMATION on which events count.
 */
export const APPROVED_INFORMATION_EVENT_CODES: readonly string[] = [
  'EXPENSE.FACTS_CORRECTED',
  'EXPENSE.REVERSED',
  'EXPENSE.PAYMENT_REVERSED',
  'EXPENSE.RECURRING_RECOGNITION_ADJUSTED',
  'EXPENSE.RECURRING_RECOGNITION_REVERSED',
  'INVENTORY.DELIVERY_SUPPLIER_CORRECTED',
  'INVENTORY.ADJUSTMENT_POSTED',
  'INVENTORY.COST_REVALUATION_POSTED',
  'SUPPLIER.DOCUMENT_REVERSED',
  'SUPPLIER.PAYMENT_REVERSED',
  'SUPPLIER.CREDIT_LIMIT_SET',
  'SUPPLIER.UPDATED',
  'CUSTOMER.UPDATED',
  'CUSTOMER.LEDGER_REVERSAL_POSTED',
  'SETUP.PRICE_DRAFTED',
];

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function buildExtraAlerts(
  facts: ExtraAlertFacts,
  settings: ExtraAlertSettings,
  station: { id: string },
): OperationsAlert[] {
  const out: OperationsAlert[] = [];
  const stationPath = `/stations/${encodeURIComponent(station.id)}`;

  const old = (facts.unbankedCash ?? []).filter(
    (row) => daysBetween(row.businessDate, facts.today) >= settings.unbankedCashDays,
  );
  if (old.length > 0) {
    const total = old.reduce(
      (sum, row) => sum.add(new ExactDecimal(row.amount)),
      new ExactDecimal('0'),
    );
    const oldest = [...old].map((row) => row.businessDate).sort()[0]!;
    out.push({
      id: 'cash-unbanked-old',
      title: `${formatUsd(total.toString())} has been unbanked for ${settings.unbankedCashDays} days or more`,
      detail: `The oldest cash is from ${oldest}. Bank it and record the deposit.`,
      href: `${stationPath}/cash`,
      tone: 'attention',
    });
  }

  const threshold = new ExactDecimal(settings.highExpenseAmount).value;
  for (const row of (facts.expenses ?? [])
    .filter((r) => new ExactDecimal(r.amount).value.gte(threshold))
    .slice(0, 3)) {
    out.push({
      id: `expense-high-${row.id}`,
      title: `A ${formatUsd(row.amount)} expense was recorded on ${row.expenseDate}`,
      detail: `${row.description}. Expenses of ${formatUsd(settings.highExpenseAmount)} or more are flagged for a look.`,
      href: '/expenses',
      tone: 'attention',
    });
  }

  const belowPrice = (facts.belowPriceSales ?? []).filter((row) =>
    new ExactDecimal(row.soldPrice).value.lt(new ExactDecimal(row.approvedPrice).value),
  );
  for (const row of belowPrice.slice(0, 3)) {
    out.push({
      id: `sale-below-price-${row.businessDate}-${row.product}`,
      title: `${row.product} was sold below the approved price on ${row.businessDate}`,
      detail: `Sold at ${formatUsd(row.soldPrice)} a litre; the approved price is ${formatUsd(row.approvedPrice)}.`,
      href: `${stationPath}/reconciliations`,
      tone: 'attention',
    });
  }
  if (belowPrice.length > 3) {
    out.push({
      id: 'sale-below-price-more',
      title: `${belowPrice.length - 3} more ${plural(belowPrice.length - 3, 'sale', 'sales')} below the approved price`,
      detail: 'See the reconciliations for the other days.',
      href: `${stationPath}/reconciliations`,
      tone: 'info',
    });
  }

  const minimum = new ExactDecimal(settings.deliveryShortageMinimumLitres).value;
  for (const row of (facts.shortDeliveries ?? [])
    .filter((r) => new ExactDecimal(r.shortLitres).value.gte(minimum))
    .slice(0, 3)) {
    out.push({
      id: `delivery-short-${row.id}`,
      title: `${row.product} delivery ${row.deliveryNote} was ${formatLitres(row.shortLitres)} short`,
      detail: `Received on ${row.businessDate}. Less fuel arrived than the delivery note says.`,
      href: '/inventory',
      tone: 'attention',
    });
  }

  const unproven = (facts.unprovenSupplierPayments ?? []).filter((row) =>
    paymentNeedsProofFlag(row.amount, 0),
  );
  for (const row of unproven.slice(0, 3)) {
    out.push({
      id: `supplier-payment-no-proof-${row.id}`,
      title: `${formatUsd(row.amount)} paid to ${row.supplierName} has no proof of payment`,
      detail: `Payment ${row.reference} on ${row.paymentDate}. Payments of US$1,000 or more should have proof attached.`,
      href: `/suppliers/${encodeURIComponent(row.supplierId)}/payments`,
      tone: 'attention',
    });
  }
  if (unproven.length > 3) {
    out.push({
      id: 'supplier-payment-no-proof-more',
      title: `${unproven.length - 3} more supplier ${plural(unproven.length - 3, 'payment has', 'payments have')} no proof of payment`,
      detail: 'Open the supplier payments to attach the proof.',
      href: '/suppliers',
      tone: 'info',
    });
  }

  for (const reminder of facts.dipReminders ?? []) {
    const tanks = reminder.tankCodes.join(', ');
    const many = reminder.tankCodes.length > 1;
    out.push({
      id: `dip-reminder-${reminder.kind.toLowerCase()}-${reminder.shiftId}`,
      title:
        reminder.kind === 'OPENING'
          ? `Take the opening dip reading on ${tanks}`
          : `Take the closing dip reading on ${tanks} before the shift ends`,
      detail:
        reminder.kind === 'OPENING'
          ? `The shift has started and ${many ? 'these tanks have' : 'this tank has'} no dip reading yet.`
          : `The shift ends within 30 minutes (or already has) and ${many ? 'these tanks have' : 'this tank has'} no closing dip reading.`,
      href: '/inventory',
      tone: 'attention',
    });
  }

  const overdue = (facts.customerOverdue ?? []).filter(
    (row) =>
      daysBetween(row.oldestUnpaidDate, facts.today) >
      (row.creditDays ?? settings.customerOverdueDays),
  );
  for (const row of overdue.slice(0, 3)) {
    out.push({
      id: `customer-overdue-${row.accountId}`,
      title: `${row.customerName} owes ${formatUsd(row.owed)}, unpaid since ${row.oldestUnpaidDate}`,
      detail: `The oldest unpaid charge is ${daysBetween(row.oldestUnpaidDate, facts.today)} days old and this customer has ${row.creditDays ?? settings.customerOverdueDays} days to pay. Payments clear the oldest charge first.`,
      href: `/customers/${encodeURIComponent(row.customerId)}`,
      tone: 'attention',
    });
  }
  if (overdue.length > 3) {
    out.push({
      id: 'customer-overdue-more',
      title: `${overdue.length - 3} more ${plural(overdue.length - 3, 'customer has', 'customers have')} overdue balances`,
      detail: 'See the customer ageing report for the others.',
      href: '/customers',
      tone: 'info',
    });
  }

  const overLimit = facts.customerOverLimit ?? [];
  for (const row of overLimit.slice(0, 3)) {
    out.push({
      id: `customer-over-limit-${row.accountId}`,
      title:
        row.kind === 'STAFF_BENEFIT_MONTH'
          ? `${row.customerName} is over the monthly staff fuel limit`
          : `${row.customerName} is over their credit limit`,
      detail:
        row.kind === 'STAFF_BENEFIT_MONTH'
          ? `${formatUsd(row.amount)} taken this month against a limit of ${formatUsd(row.limit)}.`
          : `They owe ${formatUsd(row.amount)} against a limit of ${formatUsd(row.limit)}.`,
      href: `/customers/${encodeURIComponent(row.customerId)}`,
      tone: 'attention',
    });
  }
  if (overLimit.length > 3) {
    out.push({
      id: 'customer-over-limit-more',
      title: `${overLimit.length - 3} more ${plural(overLimit.length - 3, 'account is', 'accounts are')} over their limit`,
      detail: 'See the customers list for the others.',
      href: '/customers',
      tone: 'info',
    });
  }

  const changes = facts.approvedInformationChanges ?? 0;
  if (changes > 0) {
    out.push({
      id: 'approved-information-changed',
      title: `${changes} approved ${plural(changes, 'record was', 'records were')} changed recently`,
      detail:
        'Corrections, reversals and edits to approved information. Review them in the audit trail.',
      href: '/settings',
      tone: 'info',
    });
  }
  return out;
}
