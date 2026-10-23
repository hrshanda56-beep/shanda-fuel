import { formatLitres, formatUsd } from '../../design-system/formatters';
import { ExactDecimal } from '../../platform/domain/primitives';
import { paymentNeedsProofFlag } from '../creditors/payment-proof';
import { daysBetween, type OperationsAlert } from './operations-alerts';

/**
 * Alerts added for the client brief (S18): unbanked cash that has waited too long, a high
 * expense, a sale below the approved price, a short delivery and a change to approved
 * information. Pure and exact; the server code that reads the facts is in
 * `extra-alert-facts.ts`.
 *
 * Customer "overdue" is not here on purpose: customer accounts have no due date or credit
 * period yet, so there is nothing true to measure. `ExtraAlertFacts.customerOverdue` is the
 * hook for when that data exists. Customers over their limit is already an Action Center alert.
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
}>;

export const DEFAULT_EXTRA_ALERT_SETTINGS: ExtraAlertSettings = {
  unbankedCashDays: 2,
  highExpenseAmount: '500.00',
  deliveryShortageMinimumLitres: '20',
  lookbackDays: 14,
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
  /** Hook only. Stays null until customer accounts carry a due date or credit period. */
  customerOverdue?: null;
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
