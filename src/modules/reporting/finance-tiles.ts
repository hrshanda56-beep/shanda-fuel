import type { ManagementReport } from './contracts';
import { exact } from './domain';
import {
  approvedFuelBenefit,
  buildFinancialPosition,
  recognizedOperatingExpenseTotal,
} from './statements';
import { operatingProfit } from './operating-profit';

export type FinanceTile = Readonly<{
  id:
    | 'grossProfit'
    | 'operatingProfit'
    | 'stockValue'
    | 'cashAtStations'
    | 'cashBanked'
    | 'posAwaiting'
    | 'debtors'
    | 'creditors'
    | 'netPosition'
    | 'expensesAwaitingApproval';
  label: string;
  /** Exact money text, or null when the figure is not available (never zero). */
  value: string | null;
  /** Plain words explaining an unavailable figure. */
  unavailableReason?: string;
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
  const position = buildFinancialPosition(report);
  const customersKnown = report.customers.availability === 'AVAILABLE';
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
  return [
    {
      id: 'grossProfit',
      basis: 'period',
      label: 'Gross profit',
      value: report.grossMargin,
      unavailableReason: profitReason,
      href: '/daily-profit',
    },
    {
      id: 'operatingProfit',
      basis: 'period',
      label: 'Operating profit',
      value: operating,
      unavailableReason: profitReason,
      href: '/daily-profit',
    },
    {
      id: 'stockValue',
      basis: 'as-at',
      label: 'Fuel stock value',
      value: own?.stockValue ?? null,
      unavailableReason: own
        ? own.stockValue === null
          ? 'Some stock has no cost yet.'
          : undefined
        : 'Not available.',
      href: '/financial-position',
    },
    {
      id: 'cashAtStations',
      basis: 'as-at',
      label: 'Cash at stations',
      value:
        report.cash.custody?.atStation ??
        report.cash.atStation ??
        report.cash.collectedButNotBanked,
      href: '/financial-position',
    },
    {
      id: 'cashBanked',
      basis: 'period',
      label: 'Cash banked',
      value: report.cash.banked,
      href: '/financial-position',
    },
    {
      id: 'posAwaiting',
      basis: 'as-at',
      label: 'Card and mobile payments awaiting settlement',
      value: report.providers.unmatchedEvidenceAmount,
      href: '/financial-position',
    },
    {
      id: 'debtors',
      basis: 'as-at',
      label: 'Owed by customers',
      value: report.customers.receivableBalance,
      unavailableReason: customersKnown
        ? undefined
        : 'Choose all stations to see customer balances.',
      href: '/financial-position',
    },
    {
      id: 'creditors',
      basis: 'as-at',
      label: 'Owed to suppliers',
      value: report.suppliers.outstandingBalance,
      href: '/financial-position',
    },
    {
      id: 'netPosition',
      basis: 'as-at',
      label: 'Net position',
      value: position.net,
      unavailableReason:
        position.net === null
          ? customersKnown
            ? 'Not every figure is known yet.'
            : 'Choose all stations to see the net position.'
          : undefined,
      href: '/financial-position',
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
}
