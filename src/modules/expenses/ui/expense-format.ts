import Decimal from 'decimal.js';

import { allocateFixedCosts } from '../../reporting/fixed-cost-allocation';

/** Plain-language wording and pure helpers for the Expenses page. No React, no network. */

export type ExpenseRow = {
  expenseId: string;
  stationId: string;
  category: { id: string; code: string; name: string };
  expenseDate: string;
  description: string;
  payee: string | null;
  reference: string | null;
  amount: string;
  state: string;
  version: number;
  requiredApprovals: number;
  approvals: number;
  submittedAt: string;
  rejectionReason: string | null;
  reversalReason: string | null;
  settledAmount: string;
  outstanding: string | null;
  paymentStatus: string | null;
};

export type StatusTone = 'positive' | 'neutral' | 'warning' | 'critical' | 'pending' | 'locked';

export type StatusView = { label: string; tone: StatusTone };

export function statusView(
  row: Pick<ExpenseRow, 'state' | 'paymentStatus' | 'approvals' | 'requiredApprovals'>,
): StatusView {
  switch (row.state) {
    case 'SUBMITTED':
      return {
        label:
          row.requiredApprovals > 1
            ? `Waiting for approval (${row.approvals} of ${row.requiredApprovals})`
            : 'Waiting for approval',
        tone: 'pending',
      };
    case 'APPROVED':
      return { label: 'Approved, ready to record', tone: 'neutral' };
    case 'REJECTED':
      return { label: 'Rejected', tone: 'critical' };
    case 'REVERSED':
      return { label: 'Cancelled', tone: 'locked' };
    case 'POSTED':
      if (row.paymentStatus === 'PAID') return { label: 'Paid', tone: 'positive' };
      if (row.paymentStatus === 'PARTIALLY_PAID') return { label: 'Partly paid', tone: 'warning' };
      return { label: 'Not paid yet', tone: 'warning' };
    default:
      return { label: 'Unknown', tone: 'neutral' };
  }
}

export type ExpenseFilter = 'all' | 'waiting' | 'ready' | 'unpaid' | 'paid' | 'closed';

export const EXPENSE_FILTERS: ReadonlyArray<{ value: ExpenseFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'waiting', label: 'Waiting for approval' },
  { value: 'ready', label: 'Ready to record' },
  { value: 'unpaid', label: 'Not paid yet' },
  { value: 'paid', label: 'Paid' },
  { value: 'closed', label: 'Rejected or cancelled' },
];

export function matchesFilter(row: ExpenseRow, filter: ExpenseFilter): boolean {
  switch (filter) {
    case 'waiting':
      return row.state === 'SUBMITTED';
    case 'ready':
      return row.state === 'APPROVED';
    case 'unpaid':
      return row.state === 'POSTED' && row.paymentStatus !== 'PAID';
    case 'paid':
      return row.state === 'POSTED' && row.paymentStatus === 'PAID';
    case 'closed':
      return row.state === 'REJECTED' || row.state === 'REVERSED';
    default:
      return true;
  }
}

export type PeriodKey = 'month' | 'last' | 'all';

export const PERIODS: ReadonlyArray<{ value: PeriodKey; label: string }> = [
  { value: 'month', label: 'This month' },
  { value: 'last', label: 'Last month' },
  { value: 'all', label: 'All dates' },
];

const BUSINESS_TIME_ZONE = 'Africa/Harare';

/** Today's date as YYYY-MM-DD in the business time zone, not the browser's. */
export function todayInBusinessTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE }).format(now);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** First and last day of the month for a given business day. */
export function monthRange(today: string): { from: string; to: string } {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${lastDayOfMonth(year, month)}` };
}

export function periodRange(today: string, period: PeriodKey): { from: string; to: string } | null {
  if (period === 'all') return null;
  const thisMonth = monthRange(today);
  if (period === 'month') return thisMonth;
  const [year, month] = thisMonth.from.split('-').map(Number) as [number, number];
  const previousYear = month === 1 ? year - 1 : year;
  const previousMonth = month === 1 ? 12 : month - 1;
  const mm = String(previousMonth).padStart(2, '0');
  return {
    from: `${previousYear}-${mm}-01`,
    to: `${previousYear}-${mm}-${lastDayOfMonth(previousYear, previousMonth)}`,
  };
}

export function inPeriod(date: string, range: { from: string; to: string } | null): boolean {
  return !range || (date >= range.from && date <= range.to);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-10-19" becomes "19 Oct 2026". */
export function formatFriendlyDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return '—';
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : '—';
}

/** "2026-10-19" becomes "October 2026". */
export function monthTitle(value: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(value);
  const name = match ? MONTH_NAMES[Number(match[2]) - 1] : undefined;
  return name && match ? `${name} ${match[1]}` : '';
}

export function matchesSearch(row: ExpenseRow, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return [row.description, row.payee, row.category.name, row.reference]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(text);
}

/** What a person typed to an exact decimal string with at most two decimals, or null. */
export function parseAmount(value: string): string | null {
  const text = value.trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  if (!/[1-9]/.test(text)) return null;
  return text;
}

/** A short stable code for a new category, made from its name. */
export function categoryCodeFromName(name: string): string | null {
  const code = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return code || null;
}

export type CategoryShare = { categoryId: string; name: string; amount: string; percent: number };

/** Month spending by category, biggest first. Percent is for drawing the bar only. */
export function categoryShares(
  byCategory: ReadonlyArray<{ categoryId: string; name: string; amount: string }>,
): { total: string; shares: CategoryShare[] } {
  const totals = new Map<string, { name: string; amount: Decimal }>();
  for (const row of byCategory) {
    const entry = totals.get(row.categoryId) ?? { name: row.name, amount: new Decimal(0) };
    entry.amount = entry.amount.add(new Decimal(row.amount));
    totals.set(row.categoryId, entry);
  }
  const rows = [...totals.entries()]
    .map(([categoryId, entry]) => ({ categoryId, ...entry }))
    .filter((row) => !row.amount.isZero())
    .sort((a, b) => b.amount.comparedTo(a.amount));
  const total = rows.reduce((sum, row) => sum.add(row.amount), new Decimal(0));
  return {
    total: total.toFixed(4),
    shares: rows.map((row) => ({
      categoryId: row.categoryId,
      name: row.name,
      amount: row.amount.toFixed(4),
      percent: total.gt(0)
        ? Math.max(2, Math.round(row.amount.div(total).times(100).toNumber()))
        : 0,
    })),
  };
}

export function sumAmounts(values: readonly string[]): string {
  return values.reduce((sum, value) => sum.add(new Decimal(value)), new Decimal(0)).toFixed(4);
}

/**
 * What a regular cost has counted so far this month, by the one allocation rule every screen
 * shares (monthly amount ÷ days in the month, per active day, from its start date). Nobody has to
 * add the month: a cost counts from the day it starts. A stopped cost counts nothing here.
 */
export function regularCostSoFar(
  template: { amount: string; startDate: string; endDate: string | null; status: string },
  month: { from: string; to: string },
  today: string,
): { amount: string; days: number } {
  if (template.status !== 'ACTIVE') return { amount: '0.0000', days: 0 };
  const through = today < month.to ? today : month.to;
  const days = allocateFixedCosts(
    [
      {
        id: 'regular-cost',
        stationId: 'station',
        amount: template.amount,
        startDate: template.startDate,
        endDate: template.endDate,
      },
    ],
    new Set(),
    month.from,
    through,
  );
  return { amount: sumAmounts(days.map((day) => day.amount)), days: days.length };
}

export function isStepUpMessage(message: string): boolean {
  return /step-up|strong-authentication/i.test(message);
}

/** Turns a server message into something a station owner can act on. */
export function friendlyError(message: string | null | undefined, fallback: string): string {
  const text = (message ?? '').trim();
  if (!text) return fallback;
  const rules: ReadonlyArray<[RegExp, string]> = [
    [
      /changed since it was loaded/i,
      'Someone changed this expense a moment ago. The list has been refreshed, so please look and try again.',
    ],
    [/already decided/i, 'You have already approved this expense.'],
    [
      /cannot be approved by the person who submitted/i,
      'An expense cannot be approved by the person who entered it. Ask another approver.',
    ],
    [/exceeds the outstanding/i, 'That is more than what is still owed on this expense.'],
    [/future/i, 'The date cannot be in the future.'],
    [/category with this code already exists/i, 'A category with that name already exists.'],
    [
      /active expense with this reference/i,
      'An expense with this receipt number has already been entered.',
    ],
    [
      /reverse the recorded settlements/i,
      'This expense has payments on it. Undo the payments first, then cancel the expense.',
    ],
    [/category is inactive/i, 'That category is switched off. Choose another one.'],
    [
      /cannot move to/i,
      'This expense has already moved on. The list has been refreshed, so please look and try again.',
    ],
    [/greater than zero|exact decimal/i, 'Enter an amount above zero, for example 25.50.'],
    [/already been reversed/i, 'That has already been undone.'],
    [
      /cash movement|cash disbursement/i,
      'Paying from the till is not available here yet. Choose bank or reimbursement.',
    ],
    [/not found/i, 'That could not be found. It may have been removed; refresh and try again.'],
  ];
  for (const [pattern, reply] of rules) if (pattern.test(text)) return reply;
  if (/forbidden|not permitted|permission/i.test(text)) {
    return 'You do not have permission to do this.';
  }
  return text;
}

/** An exact amount to prefill an input: two decimals unless more are genuinely there. */
export function amountForInput(value: string | null | undefined): string {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return '';
  const exact = new Decimal(value);
  return exact.decimalPlaces() <= 2 ? exact.toFixed(2) : exact.toString();
}
