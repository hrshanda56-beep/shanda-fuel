import type { ManagementReport } from './contracts';
import { exact } from './domain';
import { formatTileMoney } from './format';
import { approvedFuelBenefit, recognizedOperatingExpenseTotal } from './statements';
import { operatingProfit } from './operating-profit';

export type FinanceTile = Readonly<{
  id: 'profit' | 'stockValue' | 'creditors' | 'expensesAwaitingApproval';
  label: string;
  /** Exact money text, or null when the figure is not available (never zero). */
  value: string | null;
  /** Plain words explaining an unavailable figure. */
  unavailableReason?: string;
  /** Extra context for a known figure, kept behind the "?" on the card. */
  detail?: string;
  /** Extra count shown beside the amount, such as expenses waiting. */
  count?: number;
  /** The page that explains the figure. */
  href: string;
  /**
   * `period`: a total over the period chosen on the dashboard. `as-at`: a position right now
   * (stock, cash held, what is owed), which does not change with the period.
   */
  basis: 'period' | 'as-at';
}>;

/** The finance tiles for the dashboard, each from a figure the report already carries. */
export function buildFinanceTiles(report: ManagementReport): FinanceTile[] {
  const own = report.ownerPosition;
  // Same arithmetic as the profit statement's "Net operating result", so the tile ties to it.
  const operating = operatingProfit(
    report.grossMargin,
    recognizedOperatingExpenseTotal(report),
    approvedFuelBenefit(report),
  );
  const costMissing = report.grossMargin === null;
  // With nothing sold there is no cost to be missing, so say that instead.
  const salesValue = report.sales?.salesValue;
  const noSales = salesValue !== undefined && exact(salesValue).value.isZero();
  const profitReason = costMissing
    ? noSales
      ? 'No sales yet.'
      : 'Some sales have no fuel cost yet.'
    : undefined;
  const tiles: FinanceTile[] = [
    {
      id: 'profit',
      basis: 'period',
      label: 'Profit',
      value: operating,
      unavailableReason: profitReason,
      // Operating profit is the headline; gross is the figure before expenses and fixed costs.
      detail:
        report.grossMargin === null
          ? undefined
          : `Operating profit. Gross profit, before expenses and fixed costs, is ${formatTileMoney(report.grossMargin)}.`,
      href: '/profitability?view=daily',
    },
    {
      id: 'stockValue',
      basis: 'as-at',
      label: 'Fuel stock value',
      value: own?.stockValue ?? null,
      unavailableReason: own
        ? own.stockValue === null
          ? 'Some stock has no cost yet. Open Inventory to add it.'
          : undefined
        : 'Not available.',
      href:
        own && own.stockValue === null ? '/inventory/valuation' : '/profitability?view=position',
    },
    {
      id: 'creditors',
      basis: 'as-at',
      label: 'Owed to suppliers',
      value: report.suppliers.outstandingBalance,
      href: '/profitability?view=position',
    },
    {
      id: 'expensesAwaitingApproval',
      basis: 'as-at',
      label: 'Expenses awaiting approval',
      value: own?.expensesAwaitingApproval.amount ?? null,
      count: own?.expensesAwaitingApproval.count,
      unavailableReason: own ? undefined : 'Not available.',
      href: '/expenses',
    },
  ];
  // Nothing waiting means nothing to act on, so the tile only appears when something is.
  return own?.expensesAwaitingApproval.count === 0
    ? tiles.filter((tile) => tile.id !== 'expensesAwaitingApproval')
    : tiles;
}
