import type { StatusTone } from '../../../design-system/primitives';
import { mapA12OperatorError } from '../../costing/operator-errors';
import { clientErrorMessage } from '../../../platform/errors/client';
import { sumDecimals } from '../../cash/ui/cash-visuals';

export type DailyOperationsState =
  'DRAFT' | 'RETURNED' | 'SUBMITTED' | 'PENDING_APPROVAL' | 'APPROVED' | 'LOCKED' | string;

const DECIMAL_TEXT = /^\d+(?:\.\d+)?$/;

/**
 * Litres sold as the closing reading is typed: closing minus opening, in exact decimals. Null
 * until both readings are numbers; negative when the closing is below the opening (the screen
 * says so). The saved figure comes from the server and replaces this after a save.
 */
export function liveLitresSold(opening: string, closing: string): string | null {
  const open = opening.trim();
  const close = closing.trim();
  if (!DECIMAL_TEXT.test(open) || !DECIMAL_TEXT.test(close)) return null;
  return sumDecimals([close, `-${open}`]);
}

export type LiveCashFigures = Readonly<{
  expected: string;
  paidOut: string;
  net: string;
  difference: string | null;
}>;

/**
 * The cash figures as the person types: cash taken on the Payments step, less cash paid out on the
 * Expenses step, against the cash counted. Rows without a number are left out; the difference waits
 * until the count is a number. The saved figures come from the server and replace these on Next.
 */
export function liveCashFigures(
  payments: ReadonlyArray<{ method: string; amount: string }>,
  expenses: ReadonlyArray<{ paymentMethod: string; amount: string }>,
  counted: string,
): LiveCashFigures {
  const amounts = (rows: ReadonlyArray<string>) =>
    rows.map((value) => value.trim()).filter((value) => DECIMAL_TEXT.test(value));
  const expected = sumDecimals(
    amounts(payments.filter((item) => item.method === 'CASH').map((item) => item.amount)),
  );
  const paidOut = sumDecimals(
    amounts(expenses.filter((item) => item.paymentMethod === 'CASH').map((item) => item.amount)),
  );
  const net = sumDecimals([expected, `-${paidOut}`]);
  const count = counted.trim();
  return {
    expected,
    paidOut,
    net,
    difference: DECIMAL_TEXT.test(count) ? sumDecimals([count, `-${net}`]) : null,
  };
}

/** What each step of the shift workspace is called, for the person entering it. */
const ENTRY_TITLES = [
  'Who is on shift?',
  'Pump readings',
  'How customers paid',
  'Expenses',
  'Count the cash',
  'Tank dips and deliveries',
  'Check and submit',
] as const;

/** The same steps as management sees them: a review of a submitted shift, never a form. */
const REVIEW_TITLES = [
  'Review: who worked this shift',
  'Review: pump readings',
  'Review: how customers paid',
  'Review: expenses',
  'Review: the cash count',
  'Review: tank dips and deliveries',
  'Approve or send back',
] as const;

export function stepTitle(step: number, reviewing: boolean): string {
  const titles = reviewing ? REVIEW_TITLES : ENTRY_TITLES;
  return titles[step] ?? titles[0];
}

export function isEditableDailyOperationsState(state: DailyOperationsState | undefined): boolean {
  return state === 'DRAFT' || state === 'RETURNED';
}

export function dailyOperationsStatusTone(state: DailyOperationsState): StatusTone {
  if (state === 'APPROVED' || state === 'LOCKED') return 'locked';
  if (state === 'RETURNED') return 'warning';
  if (state === 'SUBMITTED' || state === 'PENDING_APPROVAL') return 'pending';
  return 'informational';
}

export function dailyOperationsStatusLabel(state: DailyOperationsState): string {
  return state
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Where a person can go to put a problem right: a step of this workspace, or another page. */
export type DailyOperationsFix =
  | Readonly<{ kind: 'link'; label: string; href: string }>
  | Readonly<{ kind: 'step'; label: string; step: number }>;

export type DailyOperationsProblem = Readonly<{ message: string; fix?: DailyOperationsFix }>;

const link = (label: string, href: string): DailyOperationsFix => ({ kind: 'link', label, href });
const step = (label: string, index: number): DailyOperationsFix => ({
  kind: 'step',
  label,
  step: index,
});

/**
 * What went wrong, in plain words, and where to go to put it right. A reason the server gave that
 * the person can act on is kept and matched before the generic wording for the HTTP status, so a
 * credit limit is never reported as "changed elsewhere". The step numbers are those of the
 * workspace: 0 team, 1 pumps, 2 payments, 3 expenses, 4 cash, 5 tank dips, 6 submit.
 */
export function dailyOperationsProblem(
  status: number,
  code: string | undefined,
  message: string | undefined,
): DailyOperationsProblem {
  const a12Message = mapA12OperatorError(code, message);
  if (a12Message)
    return { message: a12Message, fix: link('Open inventory valuation', '/inventory/valuation') };
  const text = message ?? '';
  if (code === 'RECONCILIATION_ALREADY_EXISTS') {
    return {
      message:
        'A reconciliation already exists for this shift. Open the existing reconciliation instead.',
      fix: link('Open reconciliations', '/operations/reconciliations'),
    };
  }
  if (/operated shift must be completed|shift is not finished yet/i.test(text)) {
    return {
      message:
        'A shift is not finished yet. Close the meters and complete every shift in the list below, or mark a shift as not operated, then close the day.',
    };
  }
  // The server states why the shift cannot be closed, and what to do, in its own words.
  if (/^This shift cannot be closed yet/i.test(text)) return { message: text };
  if (/sealed meter segments|meter-close boundary/i.test(text)) {
    return {
      message:
        'This shift cannot be closed yet because no pump readings have been submitted for it. Open the shift figures, enter the pump readings and submit them, then press Close Shift again. Nothing was changed.',
    };
  }
  if (/meter-unavailable exception/i.test(text)) {
    return {
      message:
        'A pump meter was reported unavailable for this shift and the problem is still open. Resolve it first, then press Close Shift again.',
    };
  }
  if (/no matching sealed meter-segment evidence/i.test(text)) {
    return {
      message:
        'This shift has not been closed yet, so there is nothing to approve. Ask the supervisor to press Close Shift on the shift, then approve again.',
    };
  }
  if (/sealed meter segment does not match/i.test(text)) {
    return {
      message:
        'The pump readings were changed after this shift was closed, so they no longer match the closed meters. Nothing was approved. Ask the owner or support to correct the closed meters.',
    };
  }
  if (/cannot approve it/i.test(text)) {
    return {
      message:
        'You submitted this reconciliation, so someone else must approve it. Ask another supervisor, finance or the owner.',
    };
  }
  if (/closing meter reading/i.test(text)) {
    return {
      message: 'Check the meter readings: closing cannot be below opening.',
      fix: step('Go to pump readings', 1),
    };
  }
  if (/variance explanations are required/i.test(text)) {
    return { message: text, fix: step('Go to the explanations', 6) };
  }
  if (/has no dip reading for this shift|have no dip reading for this shift/i.test(text)) {
    return { message: text, fix: step('Go to tank dips', 5) };
  }
  if (/select at least one attendant/i.test(text)) {
    return { message: text, fix: step('Choose the team', 0) };
  }
  if (/attendant is not assigned to this station/i.test(text)) {
    return {
      message:
        'One of the people chosen is not assigned to this station. Choose from the team list.',
      fix: step('Choose the team', 0),
    };
  }
  if (/who received the approved fuel|choose the customer for this credit sale/i.test(text)) {
    return { message: text, fix: step('Go to payments', 2) };
  }
  if (/credit limit|credit account|buy on account|prepaid money|cannot be charged/i.test(text)) {
    return { message: text, fix: link('Open customer accounts', '/customers') };
  }
  if (/selling price is not active/i.test(text)) {
    return {
      message:
        'The selling price for this product is not active. Set a current price, then try again.',
      fix: link('Set the selling price', '/operations/daily/price-change'),
    };
  }
  if (/pump-to-tank|unambiguous source tank/i.test(text)) {
    return {
      message:
        'This product has more than one tank, so the system cannot tell which tank the sale came from. Set up the tank for each pump, then approve again.',
      fix: link('Open tanks', '/inventory/tanks'),
    };
  }
  if (/meter-segment bridge/i.test(text)) {
    return {
      message:
        'This could not be approved on this system right now. Nothing was changed. Contact support.',
    };
  }
  if (status === 401) {
    return {
      message: 'Your session has expired. Sign in again to continue.',
      fix: link('Sign in again', '/login'),
    };
  }
  if (status === 403) return { message: 'You do not have permission for this station action.' };
  if (status === 404) {
    return {
      message: 'This station-day workspace is no longer available.',
      fix: link('Back to daily operations', '/operations'),
    };
  }
  if (status === 409 || code === 'IDEMPOTENCY_CONFLICT') {
    return {
      message:
        'This workspace changed elsewhere or is already locked. Refresh before trying again.',
    };
  }
  if (code === 'DEPENDENCY_UNAVAILABLE') {
    return {
      message:
        'The server could not complete the audit safely. Try again when the connection is stable.',
    };
  }
  if (text.includes('price')) {
    return {
      message: 'The selling price is unavailable or no longer active.',
      fix: link('Set the selling price', '/operations/daily/price-change'),
    };
  }
  if (text.includes('payment')) {
    return { message: 'Check the payment evidence and try again.', fix: step('Go to payments', 2) };
  }
  return {
    message: clientErrorMessage({
      status,
      code,
      message,
      fallback: 'The station workspace could not complete that action. Try again.',
    }),
  };
}

/** The page that puts a problem right, for screens that only have the message text. */
export function dailyOperationsLinkFix(
  message: string | undefined,
): Extract<DailyOperationsFix, { kind: 'link' }> | undefined {
  const fix = dailyOperationsProblem(0, undefined, message).fix;
  return fix?.kind === 'link' ? fix : undefined;
}

export function mapDailyOperationsError(
  status: number,
  code: string | undefined,
  message: string | undefined,
): string {
  return dailyOperationsProblem(status, code, message).message;
}
