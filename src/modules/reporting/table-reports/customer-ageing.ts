/**
 * Customer debtors ageing: which credit customers owe money and for how long. Pure part: the
 * report definition and the row building. The query is in `customer-ageing-read.ts`.
 *
 * Rule awaiting the owner's confirmation (docs/v1-owner-decisions.md item 2): a payment clears the
 * customer's oldest unpaid charge first. See `modules/customers/ageing.ts`.
 */
import { ExactDecimal } from '../../../platform/domain/primitives';
import {
  computeAccountAgeing,
  DEFAULT_CUSTOMER_CREDIT_DAYS,
  type AgeingLedgerLine,
} from '../../customers/ageing';
import type { TableReportDefinition, TableReportRow } from './definitions';

export const CUSTOMER_AGEING_REPORT: TableReportDefinition = {
  slug: 'customer-ageing',
  title: 'Customer Debtors Ageing',
  description:
    'Which credit customers owe money and for how long past their credit days (30 unless set on the account). Payments are counted against the oldest unpaid charge first.',
  category: 'credit',
  scope: 'organisation',
  emptyMessage: 'No credit customer owes money as at this date.',
  columns: [
    { key: 'customer', label: 'Customer', kind: 'text' },
    { key: 'accountReference', label: 'Account reference', kind: 'text' },
    { key: 'current', label: 'Current (USD)', kind: 'number' },
    { key: 'days1to30', label: '1-30 days (USD)', kind: 'number' },
    { key: 'days31to60', label: '31-60 days (USD)', kind: 'number' },
    { key: 'days61to90', label: '61-90 days (USD)', kind: 'number' },
    { key: 'over90', label: 'Over 90 days (USD)', kind: 'number' },
    { key: 'totalOwed', label: 'Total owed (USD)', kind: 'number' },
    { key: 'oldestUnpaid', label: 'Oldest unpaid charge', kind: 'text' },
  ],
};

export type AgeingAccountInput = Readonly<{
  customer: string;
  accountReference: string;
  /** Days the customer has to pay; null or left out means the default of 30. */
  creditDays?: number | null;
  lines: readonly AgeingLedgerLine[];
}>;

/**
 * One row per credit account that owes something, biggest debt first. Accounts that owe nothing
 * (including those in credit) are left out rather than shown as zeros.
 */
export function buildCustomerAgeingRows(
  accounts: readonly AgeingAccountInput[],
  asAt: string,
): TableReportRow[] {
  return accounts
    .map((account) => ({
      account,
      ageing: computeAccountAgeing(account.lines, {
        asAt,
        termsDays: account.creditDays ?? DEFAULT_CUSTOMER_CREDIT_DAYS,
      }),
    }))
    .filter(({ ageing }) => new ExactDecimal(ageing.totalOwed).value.gt(0))
    .sort((left, right) => {
      const diff = new ExactDecimal(right.ageing.totalOwed).value.cmp(
        new ExactDecimal(left.ageing.totalOwed).value,
      );
      return diff !== 0 ? diff : left.account.customer.localeCompare(right.account.customer);
    })
    .map(({ account, ageing }) => ({
      customer: account.customer,
      accountReference: account.accountReference,
      current: ageing.buckets.current,
      days1to30: ageing.buckets.days1to30,
      days31to60: ageing.buckets.days31to60,
      days61to90: ageing.buckets.days61to90,
      over90: ageing.buckets.over90,
      totalOwed: ageing.totalOwed,
      oldestUnpaid: ageing.oldestOpenChargeDate,
    }));
}
