import type { ManagementReport } from './contracts';
import { addExact, subtractExact } from './domain';
import { approvedFuelBenefit } from './statements';

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
}>;

/** The finance tiles for the dashboard, each from a figure the report already carries. */
export function buildFinanceTiles(report: ManagementReport): FinanceTile[] {
  const own = report.ownerPosition;
  const customersKnown = report.customers.availability === 'AVAILABLE';
  // Same arithmetic as the profit statement's "Net operating result", so the tile ties to it.
  const operating =
    report.grossMargin === null
      ? null
      : subtractExact(
          report.grossMargin,
          addExact(
            addExact(report.expenses.operatingTotal, report.expenses.fixedCostTotal),
            approvedFuelBenefit(report),
          ),
        );
  const costMissing = report.grossMargin === null;
  return [
    {
      id: 'grossProfit',
      label: 'Gross profit',
      value: report.grossMargin,
      unavailableReason: costMissing ? 'Some sales have no fuel cost yet.' : undefined,
      href: '/daily-profit',
    },
    {
      id: 'operatingProfit',
      label: 'Operating profit',
      value: operating,
      unavailableReason: costMissing ? 'Some sales have no fuel cost yet.' : undefined,
      href: '/daily-profit',
    },
    {
      id: 'stockValue',
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
      label: 'Cash at stations',
      value: report.cash.collectedButNotBanked,
      href: '/financial-position',
    },
    {
      id: 'cashBanked',
      label: 'Cash banked',
      value: report.cash.banked,
      href: '/financial-position',
    },
    {
      id: 'posAwaiting',
      label: 'Card and mobile payments awaiting settlement',
      value: report.providers.unmatchedEvidenceAmount,
      href: '/financial-position',
    },
    {
      id: 'debtors',
      label: 'Owed by customers',
      value: report.customers.receivableBalance,
      unavailableReason: customersKnown
        ? undefined
        : 'Choose all stations to see customer balances.',
      href: '/financial-position',
    },
    {
      id: 'creditors',
      label: 'Owed to suppliers',
      value: report.suppliers.outstandingBalance,
      href: '/financial-position',
    },
    {
      id: 'expensesAwaitingApproval',
      label: 'Expenses awaiting approval',
      value: own?.expensesAwaitingApproval.amount ?? null,
      count: own?.expensesAwaitingApproval.count,
      unavailableReason: own ? undefined : 'Not available.',
      href: '/expenses',
    },
  ];
}
