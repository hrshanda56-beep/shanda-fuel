/**
 * Customer debtors ageing: who owes, and for how long. Pure and isolated; no database, no UI.
 *
 * OWNER RULE AWAITING CONFIRMATION (docs/v1-owner-decisions.md, item 2): when a customer pays,
 * the payment clears the OLDEST unpaid charge first (option A, the recommendation). The owner has
 * not formally answered, so the rule lives behind `AllocationStrategy` and can be swapped without
 * touching the ageing arithmetic. Option B (a named charge) needs a new input on the payment;
 * option C (balance as a whole) would be another strategy. Neither is built.
 *
 * Amounts are exact decimal strings (NUMERIC(20,4)); nothing here uses JavaScript floats.
 * Dates are business dates ("YYYY-MM-DD", the station's own calendar day), never browser time.
 */
import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';

export const AGEING_BUCKETS = [
  { key: 'current', label: 'Current', minDays: 0, maxDays: 0 },
  { key: 'days1to30', label: '1-30 days', minDays: 1, maxDays: 30 },
  { key: 'days31to60', label: '31-60 days', minDays: 31, maxDays: 60 },
  { key: 'days61to90', label: '61-90 days', minDays: 61, maxDays: 90 },
  { key: 'over90', label: 'Over 90 days', minDays: 91, maxDays: null },
] as const;

/** Days a credit customer has to pay when their account names no period of its own. */
export const DEFAULT_CUSTOMER_CREDIT_DAYS = 30;

export type AgeingBucketKey = (typeof AGEING_BUCKETS)[number]['key'];

/** One thing that makes the customer owe more (a fuel charge or an upward adjustment). */
export type AgeingCharge = Readonly<{ id: string; businessDate: string; amount: string }>;

/** An open (still unpaid) part of a charge. */
export type OpenCharge = Readonly<{ id: string; businessDate: string; amount: string }>;

export type AgeingLedgerLine = Readonly<{
  id: string;
  businessDate: string;
  /** INCREASE = the customer owes more; DECREASE = payment, reversal or downward adjustment. */
  direction: 'INCREASE' | 'DECREASE';
  amount: string;
}>;

export type AllocationResult = Readonly<{
  /** Charges (or parts of them) that remain unpaid. */
  open: readonly OpenCharge[];
  /** Money paid beyond every charge; the customer is in credit by this much. Never aged. */
  unallocatedCredit: string;
}>;

/** Decides which charges a total of payments clears. Swap this to change the owner rule. */
export type AllocationStrategy = (
  charges: readonly AgeingCharge[],
  totalCredits: string,
) => AllocationResult;

const ZERO = new ExactDecimal('0');
const dec = (value: string) => new ExactDecimal(value);

function byAge(left: AgeingCharge, right: AgeingCharge, order: ReadonlyMap<string, number>) {
  if (left.businessDate !== right.businessDate) {
    return left.businessDate < right.businessDate ? -1 : 1;
  }
  return (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0);
}

/** Option A: payments clear the oldest charge first. */
export const allocateOldestFirst: AllocationStrategy = (charges, totalCredits) => {
  const order = new Map(charges.map((charge, index) => [charge.id, index]));
  const sorted = [...charges].sort((left, right) => byAge(left, right, order));
  let remaining = dec(totalCredits);
  const open: OpenCharge[] = [];
  for (const charge of sorted) {
    const amount = dec(charge.amount);
    if (!remaining.value.gt(0)) {
      open.push({ id: charge.id, businessDate: charge.businessDate, amount: amount.toString() });
      continue;
    }
    if (remaining.value.gte(amount.value)) {
      remaining = remaining.subtract(amount);
      continue;
    }
    open.push({
      id: charge.id,
      businessDate: charge.businessDate,
      amount: amount.subtract(remaining).toString(),
    });
    remaining = ZERO;
  }
  return { open, unallocatedCredit: remaining.toString() };
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayNumber(businessDate: string): number {
  const match = DATE.exec(businessDate);
  if (!match) throw new Error(`Not a business date: ${businessDate}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

/** Whole days from the charge's business date to the report's "as at" business date. */
export function daysBetween(chargeDate: string, asAt: string): number {
  return dayNumber(asAt) - dayNumber(chargeDate);
}

/** The business date a charge falls due: its own date plus the account's credit days. */
export function dueDateFor(chargeDate: string, creditDays: number | null | undefined): string {
  const days = creditDays ?? DEFAULT_CUSTOMER_CREDIT_DAYS;
  const due = new Date((dayNumber(chargeDate) + days) * 86_400_000);
  return due.toISOString().slice(0, 10);
}

export function bucketForAge(ageDays: number): AgeingBucketKey {
  const age = Math.max(0, ageDays);
  const found = AGEING_BUCKETS.find((bucket) => bucket.maxDays === null || age <= bucket.maxDays);
  return found?.key ?? 'over90';
}

export type AgeingBuckets = Readonly<Record<AgeingBucketKey, string>>;

export type AccountAgeing = Readonly<{
  buckets: AgeingBuckets;
  /** Everything the customer still owes (sum of the buckets). */
  totalOwed: string;
  /** Overpaid amount held in the customer's favour. Not part of any bucket. */
  unallocatedCredit: string;
  /** Business date of the oldest charge still unpaid, or null when nothing is owed. */
  oldestOpenChargeDate: string | null;
}>;

export type AgeingOptions = Readonly<{
  /** The business date the report is "as at". Required: never guessed from the clock. */
  asAt: string;
  /**
   * Days a charge is allowed before it counts as late: the account's own credit days, or
   * `DEFAULT_CUSTOMER_CREDIT_DAYS` when it names none. Left out here, 0: "Current" only on the day.
   */
  termsDays?: number;
  strategy?: AllocationStrategy;
}>;

export function emptyBuckets(): Record<AgeingBucketKey, string> {
  return { current: '0', days1to30: '0', days31to60: '0', days61to90: '0', over90: '0' };
}

/** Ages one credit account from its ledger lines. */
export function computeAccountAgeing(
  lines: readonly AgeingLedgerLine[],
  options: AgeingOptions,
): AccountAgeing {
  const strategy = options.strategy ?? allocateOldestFirst;
  const terms = options.termsDays ?? 0;
  const charges: AgeingCharge[] = lines
    .filter((line) => line.direction === 'INCREASE')
    .map((line) => ({ id: line.id, businessDate: line.businessDate, amount: line.amount }));
  const credits = lines
    .filter((line) => line.direction === 'DECREASE')
    .reduce((sum, line) => sum.add(dec(line.amount)), ZERO);
  const { open, unallocatedCredit } = strategy(charges, credits.toString());

  const buckets = emptyBuckets();
  let total = ZERO;
  let oldest: string | null = null;
  for (const charge of open) {
    const age = daysBetween(charge.businessDate, options.asAt) - terms;
    const key = bucketForAge(age);
    buckets[key] = dec(buckets[key]).add(dec(charge.amount)).toString();
    total = total.add(dec(charge.amount));
    if (oldest === null || charge.businessDate < oldest) oldest = charge.businessDate;
  }
  const money = (value: string) =>
    dec(value).quantize(DECIMAL_POLICIES.money).value.toFixed(DECIMAL_POLICIES.money.scale);
  return {
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([key, value]) => [key, money(value)]),
    ) as AgeingBuckets,
    totalOwed: money(total.toString()),
    unallocatedCredit: money(unallocatedCredit),
    oldestOpenChargeDate: oldest,
  };
}
