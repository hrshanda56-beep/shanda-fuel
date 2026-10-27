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

export function mapDailyOperationsError(
  status: number,
  code: string | undefined,
  message: string | undefined,
): string {
  const a12Message = mapA12OperatorError(code, message);
  if (a12Message) return a12Message;
  if (status === 401) return 'Your session has expired. Sign in again to continue.';
  if (status === 403) return 'You do not have permission for this station action.';
  if (status === 404) return 'This station-day workspace is no longer available.';
  if (status === 409 || code === 'IDEMPOTENCY_CONFLICT') {
    return 'This workspace changed elsewhere or is already locked. Refresh before trying again.';
  }
  if (code === 'DEPENDENCY_UNAVAILABLE') {
    return 'The server could not complete the audit safely. Try again when the connection is stable.';
  }
  if (message?.includes('Closing meter reading')) {
    return 'Check the meter readings: closing cannot be below opening.';
  }
  if (message?.includes('Variance explanations are required')) {
    return message;
  }
  if (message?.includes('price')) return 'The selling price is unavailable or no longer active.';
  if (message?.includes('payment')) return 'Check the payment evidence and try again.';
  return clientErrorMessage({
    status,
    code,
    message,
    fallback: 'The station workspace could not complete that action. Try again.',
  });
}
