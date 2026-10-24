import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';
import type {
  CanonicalRevenueReport,
  GrossMarginStatus,
  CanonicalSaleRevenue,
  RestatedCogsReport,
  RestatedSaleCogs,
} from './contracts';

function money(value: string): string {
  return new ExactDecimal(value)
    .quantize(DECIMAL_POLICIES.money)
    .value.toFixed(DECIMAL_POLICIES.money.scale);
}

function addMoney(values: readonly string[]): string {
  return values
    .reduce((total, value) => total.add(new ExactDecimal(value)), new ExactDecimal('0'))
    .quantize(DECIMAL_POLICIES.money)
    .value.toFixed(DECIMAL_POLICIES.money.scale);
}

export function summarizeCanonicalRevenue(
  sales: readonly CanonicalSaleRevenue[],
): CanonicalRevenueReport {
  return {
    currency: 'USD',
    revenueStatus: sales.length === 0 ? 'NO_SALES' : 'POSTED',
    recognizedRevenue: money(addMoney(sales.map((sale) => sale.recognizedRevenue))),
    saleCount: sales.length,
    sales,
  };
}

export function normalizeCanonicalRevenueAmount(value: string): string {
  return money(value);
}

/**
 * Gross margin is only authoritative when the complete canonical sale set has
 * both REV1 revenue and A12 restated COGS. A missing revenue row is not a zero
 * and an unvalued COGS row is not a partial margin.
 */
export function calculateGrossMargin(
  revenue: CanonicalRevenueReport,
  costing: Omit<RestatedCogsReport, 'sales'>,
): string | null {
  if (revenue.saleCount === 0 && costing.costingStatus === 'NO_SALES' && costing.saleCount === 0) {
    return null;
  }
  if (
    revenue.saleCount === 0 ||
    costing.costingStatus !== 'COMPLETE' ||
    costing.saleCount !== revenue.saleCount ||
    costing.restatedCogs === null
  ) {
    return null;
  }
  return money(
    new ExactDecimal(revenue.recognizedRevenue)
      .subtract(new ExactDecimal(costing.restatedCogs))
      .toString(),
  );
}

export function summarizeRestatedCogs(
  sales: readonly RestatedSaleCogs[],
): Omit<RestatedCogsReport, 'sales'> {
  if (sales.length === 0) {
    return {
      currency: 'USD',
      costingStatus: 'NO_SALES',
      originalCogs: '0.0000',
      revaluationDelta: '0.0000',
      restatedCogs: '0.0000',
      saleCount: 0,
      valuedSaleCount: 0,
      unvaluedSaleCount: 0,
    };
  }

  const valuedSales = sales.filter(
    (sale) => sale.valuationStatus === 'VALUED' && sale.currency === 'USD',
  );
  const unvaluedSaleCount = sales.length - valuedSales.length;
  if (unvaluedSaleCount > 0) {
    return {
      currency: 'USD',
      costingStatus: 'UNVALUED',
      originalCogs: null,
      revaluationDelta: null,
      restatedCogs: null,
      saleCount: sales.length,
      valuedSaleCount: valuedSales.length,
      unvaluedSaleCount,
    };
  }

  return {
    currency: 'USD',
    costingStatus: 'COMPLETE',
    originalCogs: addMoney(valuedSales.map((sale) => sale.originalCogs!)),
    revaluationDelta: addMoney(valuedSales.map((sale) => sale.revaluationDelta!)),
    restatedCogs: addMoney(valuedSales.map((sale) => sale.restatedCogs!)),
    saleCount: sales.length,
    valuedSaleCount: valuedSales.length,
    unvaluedSaleCount: 0,
  };
}

export function normalizeValuedSaleCogs(input: {
  originalCogs: string;
  revaluationDelta: string;
}): Pick<RestatedSaleCogs, 'originalCogs' | 'revaluationDelta' | 'restatedCogs'> {
  const originalCogs = money(input.originalCogs);
  const revaluationDelta = money(input.revaluationDelta);
  const restatedCogs = new ExactDecimal(originalCogs)
    .add(new ExactDecimal(revaluationDelta))
    .quantize(DECIMAL_POLICIES.money)
    .value.toFixed(DECIMAL_POLICIES.money.scale);
  return { originalCogs, revaluationDelta, restatedCogs };
}

export function classifyGrossMargin(
  revenue: CanonicalRevenueReport,
  costing: Omit<RestatedCogsReport, 'sales'>,
): GrossMarginStatus {
  if (revenue.saleCount === 0 && costing.saleCount === 0) return 'NOT_APPLICABLE';
  if (revenue.saleCount === 0) return 'REVENUE_MISSING';
  if (costing.costingStatus !== 'COMPLETE' || costing.restatedCogs === null) {
    return costing.costingStatus === 'NO_SALES' ? 'SALE_COUNT_MISMATCH' : 'COSTING_UNVALUED';
  }
  if (costing.saleCount !== revenue.saleCount) return 'SALE_COUNT_MISMATCH';
  return 'COMPLETE';
}
