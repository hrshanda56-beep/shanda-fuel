import { ExactDecimal } from '../../platform/domain/primitives';
import { DEFAULT_ALERT_SETTINGS, daysBetween } from '../approvals/operations-alerts';

/**
 * The plain-language status of card (POS) and EcoCash money on its way from the provider.
 * Worked out from what is recorded; nothing is stored. The overdue limit is the same
 * "days before a payment is overdue" setting the alerts use (default in DEFAULT_ALERT_SETTINGS).
 */

export const PAYMENT_SETTLEMENT_LABELS = {
  AWAITING: 'Awaiting settlement',
  PARTLY_SETTLED: 'Partly settled',
  SETTLED: 'Settled',
  OVERDUE: 'Overdue',
} as const;
export type PaymentSettlementStatus = keyof typeof PAYMENT_SETTLEMENT_LABELS;

export function paymentSettlementLabel(status: PaymentSettlementStatus): string {
  return PAYMENT_SETTLEMENT_LABELS[status];
}

/** The overdue limit in days: the organisation's own setting, or the shared default. */
export function overdueAfterDays(setting?: number | null): number {
  return typeof setting === 'number' && Number.isFinite(setting) && setting >= 0
    ? setting
    : DEFAULT_ALERT_SETTINGS.posSettlementLagDays;
}

/** Owner default: mobile-money (EcoCash and similar) settles slower than card, so it gets 2 more days. */
export const MOBILE_MONEY_EXTRA_DAYS = 2;

/** The overdue limit for one kind of payment. */
export function overdueLimitFor(method: 'CARD' | 'MOBILE_MONEY', setting?: number | null): number {
  const base = overdueAfterDays(setting);
  return method === 'MOBILE_MONEY' ? base + MOBILE_MONEY_EXTRA_DAYS : base;
}

/**
 * Status of card or mobile sales for one payment (or one day of them).
 * - everything matched to a provider settlement: Settled;
 * - something still waiting and older than the limit: Overdue (whether or not part has arrived);
 * - something matched but the rest still inside the limit: Partly settled;
 * - nothing matched, inside the limit: Awaiting settlement.
 */
export function derivePaymentSettlementStatus(input: {
  amount: string;
  allocatedAmount: string;
  /** The day the sale happened (YYYY-MM-DD, station date). */
  businessDate: string;
  /** Today at the station (YYYY-MM-DD). */
  today: string;
  overdueAfterDays?: number | null;
  /** Card by default; mobile money is given a little longer before it counts as overdue. */
  method?: 'CARD' | 'MOBILE_MONEY';
}): PaymentSettlementStatus {
  const amount = new ExactDecimal(input.amount);
  const allocated = new ExactDecimal(input.allocatedAmount);
  if (amount.value.gt(0) && allocated.value.gte(amount.value)) return 'SETTLED';
  const limit = overdueLimitFor(input.method ?? 'CARD', input.overdueAfterDays);
  if (daysBetween(input.businessDate, input.today) > limit) return 'OVERDUE';
  return allocated.value.gt(0) ? 'PARTLY_SETTLED' : 'AWAITING';
}

/** What the provider kept: fee plus any other deduction, exact. Null when neither is known. */
export function providerCharges(input: {
  feeAmount: string | null;
  deductionAmount: string | null;
}): string | null {
  if (input.feeAmount === null && input.deductionAmount === null) return null;
  return new ExactDecimal(input.feeAmount ?? '0')
    .add(new ExactDecimal(input.deductionAmount ?? '0'))
    .toString();
}

/**
 * The same words for a provider settlement that was already recorded. "Needs review" is a
 * settlement that was matched with a difference.
 */
export const SETTLEMENT_RECORD_LABELS = {
  RECORDED: PAYMENT_SETTLEMENT_LABELS.AWAITING,
  PARTIALLY_MATCHED: PAYMENT_SETTLEMENT_LABELS.PARTLY_SETTLED,
  RECONCILED: PAYMENT_SETTLEMENT_LABELS.SETTLED,
  EXCEPTION: 'Settled with a difference',
} as const;

export function settlementRecordLabel(state: string): string {
  return state in SETTLEMENT_RECORD_LABELS
    ? SETTLEMENT_RECORD_LABELS[state as keyof typeof SETTLEMENT_RECORD_LABELS]
    : state;
}

/**
 * Provider batch states used in cash banking (DECLARED/MATCHED/SETTLED/DISPUTED/REVERSED), in the
 * same vocabulary, so the two sets of stored words show up as one set of plain names.
 */
export const PROVIDER_BATCH_LABELS = {
  DECLARED: PAYMENT_SETTLEMENT_LABELS.AWAITING,
  MATCHED: PAYMENT_SETTLEMENT_LABELS.PARTLY_SETTLED,
  SETTLED: PAYMENT_SETTLEMENT_LABELS.SETTLED,
  DISPUTED: 'Needs review',
  REVERSED: 'Reversed',
} as const;

export function providerBatchLabel(state: string): string {
  return state in PROVIDER_BATCH_LABELS
    ? PROVIDER_BATCH_LABELS[state as keyof typeof PROVIDER_BATCH_LABELS]
    : state;
}
