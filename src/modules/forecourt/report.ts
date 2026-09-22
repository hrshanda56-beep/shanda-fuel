import {
  DECIMAL_POLICIES,
  ExactDecimal,
  money,
  type CurrencyCode,
  type Money,
} from '../../platform/domain/primitives';
import type { MeterSegment, PaymentDeclaration, ReconciliationRevision } from './domain';

export type DailyForecourtReport = {
  tenantId: string;
  stationId: string;
  businessDayId: string;
  currency: CurrencyCode;
  segmentCount: number;
  litresSold: string;
  expectedSales: Money;
  accountedSales: Money;
  variance: Money;
  reconciliationState: ReconciliationRevision['state'];
  lineage: readonly {
    segmentId: string;
    nozzleId: string;
    litres: string;
    expectedSaleValue: Money;
  }[];
  declarationsByCategory: Readonly<Record<PaymentDeclaration['category'], Money>>;
};

/** Rebuildable operational report source; it never creates a second financial truth. */
export function buildDailyForecourtReport(input: {
  segments: readonly MeterSegment[];
  revision: ReconciliationRevision;
}): DailyForecourtReport {
  const currency = input.revision.expectedSales.currency;
  let litresSold = new ExactDecimal('0');
  const declarations = new Map<PaymentDeclaration['category'], ExactDecimal>();
  for (const segment of input.segments) {
    litresSold = litresSold.add(segment.litres);
  }
  for (const declaration of input.revision.declarations) {
    declarations.set(
      declaration.category,
      (declarations.get(declaration.category) ?? new ExactDecimal('0')).add(
        declaration.amount.amount,
      ),
    );
  }
  const declarationsByCategory = Object.fromEntries(
    [...declarations.entries()].map(([category, amount]) => [
      category,
      money(amount.quantize(DECIMAL_POLICIES.money).toString(), currency),
    ]),
  ) as Record<PaymentDeclaration['category'], Money>;
  return {
    tenantId: input.revision.tenantId,
    stationId: input.revision.stationId,
    businessDayId: input.revision.businessDayId,
    currency,
    segmentCount: input.segments.length,
    litresSold: litresSold.quantize(DECIMAL_POLICIES.litres).toString(),
    expectedSales: input.revision.expectedSales,
    accountedSales: input.revision.accountedSales,
    variance: input.revision.variance,
    reconciliationState: input.revision.state,
    lineage: input.segments.map((segment) => ({
      segmentId: segment.id,
      nozzleId: segment.nozzleId,
      litres: segment.litres.toString(),
      expectedSaleValue: segment.expectedSaleValue,
    })),
    declarationsByCategory,
  };
}
