/**
 * Daily operating profit, per fuel and combined. Pure: it only regroups figures the management
 * report already carries (canonical revenue, restated weighted-average cost of sales and recognised
 * expenses) and adds or subtracts them exactly. Fixed costs arrive already converted to a daily
 * amount by the recurring-cost recognition (expenses/domain.ts dailyRecognitionSchedule), so each
 * recognition date is one day of fixed cost.
 */
import {
  averageRealizedPrice,
  exact,
  formatLitres,
  formatMoney,
  subtractExact,
  sumExact,
} from '../reporting/domain';

export type DailyProfitSale = Readonly<{
  businessDate: string;
  productId: string;
  productCode: string;
  productName: string;
  recognizedRevenue: string;
  quantityLitres: string;
}>;

export type DailyProfitCost = Readonly<{
  businessDate: string;
  productId: string;
  productCode?: string;
  productName?: string;
  restatedCogs: string | null;
  valuationStatus: string;
}>;

export type DailyProfitExpense = Readonly<{
  businessDate: string;
  classification: 'OPERATING' | 'FIXED_COST' | 'DIRECT_INVENTORY_COST';
  amount: string;
}>;

export type DailyProfitInput = Readonly<{
  sales: readonly DailyProfitSale[];
  costs: readonly DailyProfitCost[];
  expenses: readonly DailyProfitExpense[];
  /**
   * Fuel given to staff and management (DEC-044), at selling price, on the day it was issued.
   * It is a cost on that day, so every day row and the period total follow one rule.
   */
  fuelBenefitByDate?: readonly Readonly<{ businessDate: string; amount: string }>[];
}>;

/** One fuel on one day, or one fuel over the whole period. */
export type FuelProfitLine = Readonly<{
  productId: string;
  productCode: string;
  productName: string;
  litres: string;
  sales: string;
  /** Null when any sale of this fuel has no cost yet. */
  costOfFuelSold: string | null;
  grossProfit: string | null;
  grossProfitPerLitre: string | null;
  unvaluedSaleCount: number;
}>;

export type CombinedProfitLine = Readonly<{
  litres: string;
  sales: string;
  costOfFuelSold: string | null;
  grossProfit: string | null;
  grossProfitPerLitre: string | null;
  expenses: string;
  fixedCosts: string;
  /** Fuel given to staff and management, counted as a cost (DEC-044). */
  fuelBenefit: string;
  /**
   * Gross profit minus expenses, fixed costs and staff fuel; null when gross profit is unknown.
   * The one operating-profit figure: the dashboard and every report use this rule.
   */
  operatingProfit: string | null;
}>;

export type DailyProfitDay = Readonly<{
  date: string;
  fuels: readonly FuelProfitLine[];
  combined: CombinedProfitLine;
}>;

export type DailyProfitSummary = Readonly<{
  days: readonly DailyProfitDay[];
  fuels: readonly FuelProfitLine[];
  combined: CombinedProfitLine;
  /** Fuel given to staff and management over the period: the sum of the days. */
  fuelBenefit: string;
  /** Same as `combined.operatingProfit`: after staff fuel, null when gross profit is unknown. */
  operatingProfitAfterBenefit: string | null;
}>;

type Fuel = Readonly<{ productId: string; productCode: string; productName: string }>;

function fuelLine(
  fuel: Fuel,
  sales: readonly DailyProfitSale[],
  costs: readonly DailyProfitCost[],
): FuelProfitLine {
  const litres = formatLitres(sumExact(sales.map((sale) => sale.quantityLitres)));
  const revenue = formatMoney(sumExact(sales.map((sale) => sale.recognizedRevenue)));
  const unvalued = costs.filter(
    (cost) => cost.valuationStatus !== 'VALUED' || cost.restatedCogs === null,
  ).length;
  // A fuel with sales but no cost record at all is also unvalued: cost is never invented.
  const costMissing = unvalued > 0 || (sales.length > 0 && costs.length === 0);
  const cost = costMissing ? null : formatMoney(sumExact(costs.map((entry) => entry.restatedCogs)));
  const profit = cost === null ? null : formatMoney(subtractExact(revenue, cost));
  return {
    ...fuel,
    litres,
    sales: revenue,
    costOfFuelSold: cost,
    grossProfit: profit,
    grossProfitPerLitre: profit === null ? null : averageRealizedPrice(litres, profit),
    unvaluedSaleCount: costMissing ? Math.max(unvalued, sales.length - costs.length, 1) : 0,
  };
}

function combine(
  fuels: readonly FuelProfitLine[],
  expenses: readonly DailyProfitExpense[],
  fuelBenefit: string,
): CombinedProfitLine {
  const litres = formatLitres(sumExact(fuels.map((fuel) => fuel.litres)));
  const sales = formatMoney(sumExact(fuels.map((fuel) => fuel.sales)));
  const known = fuels.every((fuel) => fuel.grossProfit !== null);
  const cost = known ? formatMoney(sumExact(fuels.map((fuel) => fuel.costOfFuelSold))) : null;
  const gross = cost === null ? null : formatMoney(subtractExact(sales, cost));
  const operating = formatMoney(
    sumExact(expenses.filter((e) => e.classification === 'OPERATING').map((e) => e.amount)),
  );
  const fixed = formatMoney(
    sumExact(expenses.filter((e) => e.classification === 'FIXED_COST').map((e) => e.amount)),
  );
  return {
    litres,
    sales,
    costOfFuelSold: cost,
    grossProfit: gross,
    grossProfitPerLitre: gross === null ? null : averageRealizedPrice(litres, gross),
    expenses: operating,
    fixedCosts: fixed,
    fuelBenefit,
    operatingProfit:
      gross === null
        ? null
        : formatMoney(
            subtractExact(subtractExact(subtractExact(gross, operating), fixed), fuelBenefit),
          ),
  };
}

function groupFuels(
  sales: readonly DailyProfitSale[],
  costs: readonly DailyProfitCost[],
): FuelProfitLine[] {
  const fuels = new Map<string, Fuel>();
  for (const sale of sales) {
    fuels.set(sale.productId, {
      productId: sale.productId,
      productCode: sale.productCode,
      productName: sale.productName,
    });
  }
  for (const cost of costs) {
    if (!fuels.has(cost.productId)) {
      fuels.set(cost.productId, {
        productId: cost.productId,
        productCode: cost.productCode ?? 'UNKNOWN',
        productName: cost.productName ?? 'Unknown fuel',
      });
    }
  }
  return [...fuels.values()]
    .sort((a, b) =>
      `${a.productName}\u0000${a.productId}`.localeCompare(`${b.productName}\u0000${b.productId}`),
    )
    .map((fuel) =>
      fuelLine(
        fuel,
        sales.filter((sale) => sale.productId === fuel.productId),
        costs.filter((cost) => cost.productId === fuel.productId),
      ),
    );
}

/** Daily and period operating profit. Days are the dates that have a sale, a cost or an expense. */
export function buildDailyProfit(input: DailyProfitInput): DailyProfitSummary {
  const expenses = input.expenses.filter((e) => e.classification !== 'DIRECT_INVENTORY_COST');
  const benefits = input.fuelBenefitByDate ?? [];
  const benefitOn = (date: string) =>
    formatMoney(
      sumExact(benefits.filter((row) => row.businessDate === date).map((row) => row.amount)),
    );
  const dates = [
    ...new Set([
      ...input.sales.map((s) => s.businessDate),
      ...input.costs.map((c) => c.businessDate),
      ...expenses.map((e) => e.businessDate),
      ...benefits.map((row) => row.businessDate),
    ]),
  ].sort();
  const days = dates.map((date) => {
    const fuels = groupFuels(
      input.sales.filter((s) => s.businessDate === date),
      input.costs.filter((c) => c.businessDate === date),
    );
    return {
      date,
      fuels,
      combined: combine(
        fuels,
        expenses.filter((e) => e.businessDate === date),
        benefitOn(date),
      ),
    };
  });
  const fuels = groupFuels(input.sales, input.costs);
  // The period is the sum of its days: staff fuel is never applied to the total on its own.
  const fuelBenefit = formatMoney(sumExact(days.map((day) => day.combined.fuelBenefit)));
  const combined = combine(fuels, expenses, fuelBenefit);
  return {
    days,
    fuels,
    combined,
    fuelBenefit,
    operatingProfitAfterBenefit: combined.operatingProfit,
  };
}

/** The sign of a result, for the clear profit / loss flag. Null means not known. */
export function profitSign(value: string | null): 'PROFIT' | 'LOSS' | 'BREAK_EVEN' | 'UNKNOWN' {
  if (value === null) return 'UNKNOWN';
  const amount = exact(value).value;
  if (amount.isZero()) return 'BREAK_EVEN';
  return amount.isNegative() ? 'LOSS' : 'PROFIT';
}
