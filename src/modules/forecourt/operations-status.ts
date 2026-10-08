export const OPERATIONS_CLOSE_STATUSES = [
  'NOT_STARTED',
  'OPEN',
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
  'CLOSED',
  'BLOCKED',
  'EXCEPTION',
] as const;
export type OperationsCloseStatus = (typeof OPERATIONS_CLOSE_STATUSES)[number];

export const OPERATIONS_APPROVAL_STATUSES = [
  'NO_REVISION',
  'DRAFT',
  'READY',
  'SUBMITTED',
  'PENDING_APPROVAL',
  'RETURNED',
  'REJECTED',
  'APPROVED',
  'POSTED',
  'LOCKED',
] as const;
export type OperationsApprovalStatus = (typeof OPERATIONS_APPROVAL_STATUSES)[number];

export type OperationsStatusProjection = Readonly<{
  close: OperationsCloseStatus;
  approval: OperationsApprovalStatus;
}>;

const approvalPriority: readonly OperationsApprovalStatus[] = [
  'RETURNED',
  'REJECTED',
  'PENDING_APPROVAL',
  'SUBMITTED',
  'READY',
  'DRAFT',
  'APPROVED',
  'POSTED',
  'LOCKED',
];

function approvalStatus(
  reconciliationStates: readonly string[],
  revisionStates: readonly string[],
): OperationsApprovalStatus {
  const states = [...revisionStates, ...reconciliationStates];
  for (const candidate of approvalPriority) {
    if (states.includes(candidate)) return candidate;
  }
  return 'NO_REVISION';
}

export function projectOperationsStatus(input: {
  businessDayState: string;
  shiftStates: readonly string[];
  reconciliationStates: readonly string[];
  revisionStates: readonly string[];
}): OperationsStatusProjection {
  const approval = approvalStatus(input.reconciliationStates, input.revisionStates);
  const hasReviewState = [
    'READY',
    'SUBMITTED',
    'PENDING_APPROVAL',
    'APPROVED',
    'POSTED',
    'LOCKED',
  ].includes(approval);

  let close: OperationsCloseStatus;
  if (input.businessDayState === 'NOT_STARTED') {
    close = 'NOT_STARTED';
  } else if (input.businessDayState === 'EXCEPTIONALLY_CLOSED') {
    close = 'EXCEPTION';
  } else if (input.businessDayState === 'CLOSED' || input.businessDayState === 'LOCKED') {
    close = 'CLOSED';
  } else if (['RETURNED', 'REJECTED'].includes(approval)) {
    close = 'BLOCKED';
  } else if (hasReviewState || input.businessDayState === 'OPERATIONS_COMPLETE') {
    close = 'READY_FOR_REVIEW';
  } else if (
    input.businessDayState === 'OPEN' &&
    input.shiftStates.some((state) => ['OPEN', 'METER_CLOSED', 'COMPLETED'].includes(state))
  ) {
    close = 'IN_PROGRESS';
  } else if (input.businessDayState === 'OPEN') {
    close = 'OPEN';
  } else {
    close = 'IN_PROGRESS';
  }

  return { close, approval };
}
