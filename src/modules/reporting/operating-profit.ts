import { subtractExact } from './domain';

/**
 * The one operating-profit policy used by reports and owner views.
 * Approved staff/management fuel is a benefit cost, not cash revenue, so it is deducted after
 * ordinary operating and fixed expenses (DEC-044).
 */
export function operatingProfit(
  grossProfit: string | null,
  expenses: string,
  approvedFuelBenefit = '0',
): string | null {
  if (grossProfit === null) return null;
  return subtractExact(subtractExact(grossProfit, expenses), approvedFuelBenefit);
}
