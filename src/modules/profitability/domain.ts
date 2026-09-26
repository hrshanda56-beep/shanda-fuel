import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';
import type { RestatedCogsReport, RestatedSaleCogs } from './contracts';

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
