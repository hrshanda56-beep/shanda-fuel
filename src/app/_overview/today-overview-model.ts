import type { StatusTone } from '@/design-system/primitives';
import type {
  OperationsApprovalStatus,
  OperationsCloseStatus,
} from '@/modules/forecourt/operations-status';

/**
 * Presentation of the server-projected Daily Operations status. The server
 * owns the status values; this only maps them to plain wording and a tone.
 */
export const CLOSE_STATUS_PRESENTATION: Readonly<
  Record<OperationsCloseStatus, { label: string; tone: StatusTone }>
> = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  OPEN: { label: 'Open', tone: 'informational' },
  IN_PROGRESS: { label: 'In progress', tone: 'informational' },
  READY_FOR_REVIEW: { label: 'Ready for review', tone: 'pending' },
  CLOSED: { label: 'Closed', tone: 'positive' },
  BLOCKED: { label: 'Blocked', tone: 'critical' },
  EXCEPTION: { label: 'Closed with exception', tone: 'warning' },
};

const APPROVAL_LABELS: Readonly<Record<OperationsApprovalStatus, string>> = {
  NO_REVISION: '',
  DRAFT: 'Draft',
  READY: 'Ready to submit',
  SUBMITTED: 'Submitted',
  PENDING_APPROVAL: 'Awaiting approval',
  RETURNED: 'Returned for changes',
  REJECTED: 'Rejected',
  APPROVED: 'Approved',
  POSTED: 'Posted',
  LOCKED: 'Locked',
};

/** Empty when there is no revision to describe. */
export function approvalLabel(status: OperationsApprovalStatus): string {
  return APPROVAL_LABELS[status] ?? '';
}

export type TodayOperations = {
  station: { name: string };
  currentBusinessDate: string;
  status: { close: OperationsCloseStatus; approval: OperationsApprovalStatus };
  shifts: ReadonlyArray<{ id: string; state: string }>;
};

export type AttentionRow = { id: string; title: string; detail: string; href: string };

/**
 * Only states the server already marks as needing a person are surfaced.
 * Nothing is inferred, and no approval record is created or implied.
 */
export function operationsAttention(
  operations: TodayOperations,
  href: string,
): AttentionRow | null {
  const { close, approval } = operations.status;
  const station = operations.station.name;
  if (close === 'BLOCKED') {
    return {
      id: 'operations-blocked',
      title: `${station} is blocked`,
      detail:
        approvalLabel(approval) || 'Daily operations cannot be completed until this is resolved.',
      href,
    };
  }
  if (close === 'EXCEPTION') {
    return {
      id: 'operations-exception',
      title: `${station} closed with an exception`,
      detail: 'Review the day before it is locked.',
      href,
    };
  }
  if (close === 'READY_FOR_REVIEW') {
    return {
      id: 'operations-review',
      title: `${station} is ready for review`,
      detail: approvalLabel(approval) || 'The day is waiting for a reviewer.',
      href,
    };
  }
  return null;
}

export function countSuspendedCustomers(customers: ReadonlyArray<{ status: string }>): number {
  return customers.filter((customer) => customer.status === 'SUSPENDED').length;
}

export function shiftSummary(shifts: ReadonlyArray<{ state: string }>): string {
  if (shifts.length === 0) return 'No shifts yet';
  const open = shifts.filter((shift) => shift.state === 'OPEN').length;
  const noun = shifts.length === 1 ? 'shift' : 'shifts';
  return open > 0 ? `${shifts.length} ${noun} · ${open} open` : `${shifts.length} ${noun}`;
}
