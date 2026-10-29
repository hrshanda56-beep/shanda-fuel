import type { StatusTone } from '../../../design-system/primitives';
import { mapA12OperatorError } from '../../costing/operator-errors';
import { clientErrorMessage } from '../../../platform/errors/client';

export type DailyOperationsState =
  'DRAFT' | 'RETURNED' | 'SUBMITTED' | 'PENDING_APPROVAL' | 'APPROVED' | 'LOCKED' | string;

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
 * workspace: 0 team, 1 pumps, 2 payments, 3 expenses, 4 cash, 5 submit.
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
    return { message: text, fix: step('Go to the explanations', 5) };
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
