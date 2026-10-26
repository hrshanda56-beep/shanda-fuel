/**
 * Staff fuel benefit: the month-end expense (owner decision 8, "the cost goes to expenses, not
 * sales"). Once a calendar month has closed, an owner or administrator posts ONE expense per
 * benefit account and station for the fuel taken that month, valued at what the fuel cost (the
 * restated weighted-average cost already kept by the costing module), not at the selling price.
 * The expense then follows the normal expense workflow (approval, posting, correction, reversal).
 *
 * Pure and exact: litres and money are decimal strings, rates are rounded to the weighted-average
 * cost scale (8 decimals) and the total to money scale (4 decimals), never through floats.
 */
import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';
import { AppError } from '../../platform/errors';

export const STAFF_BENEFIT_EXPENSE_CATEGORY_CODE = 'STAFF_FUEL_BENEFIT';
export const STAFF_BENEFIT_EXPENSE_CATEGORY_NAME = 'Staff fuel benefit';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function assertBenefitMonth(month: string): string {
  if (!MONTH.test(month)) throw new AppError('VALIDATION_FAILED', 'A YYYY-MM month is required');
  return month;
}

export function benefitMonthStart(month: string): string {
  return `${assertBenefitMonth(month)}-01`;
}

export function benefitMonthEnd(month: string): string {
  const [year, mon] = assertBenefitMonth(month).split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

/** The expense is dated on the last day of the month it covers. */
export const benefitExpenseDate = benefitMonthEnd;

/** A month can be posted only after it has fully passed in the station's own time. */
export function isBenefitMonthClosed(month: string, stationToday: string): boolean {
  return benefitMonthEnd(month) < stationToday;
}

/**
 * The expense reference. The expense module already refuses a second active expense with the same
 * reference at a station, so this is what stops the same account being posted twice for a month
 * (a rejected or reversed expense frees it, so a wrong one can be redone).
 */
export function staffBenefitExpenseReference(accountId: string, month: string): string {
  return `STAFF-BENEFIT:${accountId}:${assertBenefitMonth(month)}`;
}

export type BenefitFuelTaken = Readonly<{
  productId: string;
  productName: string;
  litres: string;
  /** What the staff member was charged at the pump price. Shown for context only. */
  soldValue: string;
}>;

export type BenefitProductCost = Readonly<{
  productId: string;
  /** Litres sold at the station in the month with a recorded cost. */
  costedLitres: string;
  /** Restated cost of those litres. */
  cogs: string;
}>;

export type BenefitCostLine = Readonly<{
  productId: string;
  productName: string;
  litres: string;
  soldValue: string;
  costPerLitre: string;
  cost: string;
}>;

export type BenefitCostResult =
  | Readonly<{ status: 'READY'; lines: readonly BenefitCostLine[]; total: string }>
  | Readonly<{ status: 'NO_FUEL' }>
  | Readonly<{ status: 'UNAVAILABLE'; missing: readonly string[] }>;

const money = (value: ExactDecimal) =>
  value.quantize(DECIMAL_POLICIES.money).value.toFixed(DECIMAL_POLICIES.money.scale);

/**
 * Cost of the fuel taken. The average cost per litre for a product is that station's restated cost
 * of goods sold for the month divided by the litres it covers. A product with no costed sales in
 * the month makes the whole figure unavailable: nothing is guessed.
 */
export function computeBenefitCost(
  fuel: readonly BenefitFuelTaken[],
  costs: readonly BenefitProductCost[],
): BenefitCostResult {
  const taken = fuel.filter((row) => new ExactDecimal(row.litres).value.gt(0));
  if (taken.length === 0) return { status: 'NO_FUEL' };
  const missing: string[] = [];
  const lines: BenefitCostLine[] = [];
  let total = new ExactDecimal('0');
  for (const row of taken) {
    const cost = costs.find((entry) => entry.productId === row.productId);
    const costedLitres = cost ? new ExactDecimal(cost.costedLitres) : null;
    if (!cost || !costedLitres || !costedLitres.value.gt(0)) {
      missing.push(row.productName);
      continue;
    }
    const perLitre = new ExactDecimal(
      new ExactDecimal(cost.cogs).value
        .div(costedLitres.value)
        .toDecimalPlaces(DECIMAL_POLICIES.weightedAverageCost.scale)
        .toFixed(DECIMAL_POLICIES.weightedAverageCost.scale),
    );
    const lineCost = new ExactDecimal(row.litres)
      .multiply(perLitre)
      .quantize(DECIMAL_POLICIES.money);
    total = total.add(lineCost);
    lines.push({
      productId: row.productId,
      productName: row.productName,
      litres: new ExactDecimal(row.litres)
        .quantize(DECIMAL_POLICIES.litres)
        .value.toFixed(DECIMAL_POLICIES.litres.scale),
      soldValue: money(new ExactDecimal(row.soldValue)),
      costPerLitre: perLitre.value.toFixed(DECIMAL_POLICIES.weightedAverageCost.scale),
      cost: money(lineCost),
    });
  }
  if (missing.length > 0) return { status: 'UNAVAILABLE', missing };
  if (!total.value.gt(0)) return { status: 'UNAVAILABLE', missing: ['cost'] };
  return { status: 'READY', lines, total: money(total) };
}

export function staffBenefitExpenseDescription(staffName: string, month: string): string {
  return `Staff fuel benefit for ${staffName.trim()}, ${assertBenefitMonth(month)} (fuel at cost)`;
}
