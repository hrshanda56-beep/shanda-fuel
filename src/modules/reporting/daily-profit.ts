import { buildDailyProfit, type DailyProfitSummary } from '../profitability/daily-profit';
import type { ManagementReport } from './contracts';
import { approvedFuelBenefit } from './statements';

/** The owner's daily profit view, built only from figures the management report carries. */
export function dailyProfitFromReport(report: ManagementReport): DailyProfitSummary {
  return buildDailyProfit({
    sales: report.revenue.sales.map((sale) => ({
      businessDate: sale.businessDate,
      productId: sale.productId,
      productCode: sale.productCode,
      productName: sale.productName,
      recognizedRevenue: sale.recognizedRevenue,
      quantityLitres: sale.quantityLitres,
    })),
    costs: report.costing.sales.map((sale) => ({
      businessDate: sale.businessDate,
      productId: sale.productId,
      productCode: sale.productCode,
      productName: sale.productName,
      restatedCogs: sale.restatedCogs,
      valuationStatus: sale.valuationStatus,
    })),
    expenses: report.expenses.rows.map((row) => ({
      businessDate: row.businessDate,
      classification: row.classification,
      amount: row.amount,
    })),
    fuelBenefit: approvedFuelBenefit(report),
  });
}
