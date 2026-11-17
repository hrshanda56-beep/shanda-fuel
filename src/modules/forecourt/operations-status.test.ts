import { describe, expect, it } from 'vitest';
import { projectOperationsStatus } from './operations-status';

describe('projectOperationsStatus', () => {
  it('keeps an open day with active shifts in progress', () => {
    expect(
      projectOperationsStatus({
        businessDayState: 'OPEN',
        shiftStates: ['OPEN'],
        reconciliationStates: ['DRAFT'],
        revisionStates: ['DRAFT'],
      }),
    ).toEqual({ close: 'IN_PROGRESS', approval: 'DRAFT' });
  });

  it('projects existing ready and review states without creating approval records', () => {
    expect(
      projectOperationsStatus({
        businessDayState: 'OPEN',
        shiftStates: ['COMPLETED'],
        reconciliationStates: ['READY'],
        revisionStates: ['READY'],
      }),
    ).toEqual({ close: 'READY_FOR_REVIEW', approval: 'READY' });
  });

  it('says an approved day that is not closed yet is ready to close, not ready for review', () => {
    for (const approval of ['APPROVED', 'POSTED', 'LOCKED']) {
      expect(
        projectOperationsStatus({
          businessDayState: 'OPEN',
          shiftStates: ['COMPLETED'],
          reconciliationStates: [approval],
          revisionStates: [approval],
        }),
      ).toEqual({ close: 'READY_TO_CLOSE', approval });
    }
  });

  it('keeps an approved day in progress while a shift is still running', () => {
    expect(
      projectOperationsStatus({
        businessDayState: 'OPEN',
        shiftStates: ['COMPLETED', 'OPEN'],
        reconciliationStates: ['APPROVED'],
        revisionStates: ['APPROVED'],
      }),
    ).toEqual({ close: 'IN_PROGRESS', approval: 'APPROVED' });
  });

  it('still waits for a reviewer while the approval is submitted or pending', () => {
    for (const approval of ['SUBMITTED', 'PENDING_APPROVAL']) {
      expect(
        projectOperationsStatus({
          businessDayState: 'OPEN',
          shiftStates: ['COMPLETED'],
          reconciliationStates: [approval],
          revisionStates: [approval],
        }).close,
      ).toBe('READY_FOR_REVIEW');
    }
  });

  it('projects returned or rejected revisions as blocked', () => {
    expect(
      projectOperationsStatus({
        businessDayState: 'OPERATIONS_COMPLETE',
        shiftStates: ['COMPLETED'],
        reconciliationStates: ['RETURNED'],
        revisionStates: ['RETURNED'],
      }),
    ).toEqual({ close: 'BLOCKED', approval: 'RETURNED' });
  });

  it('preserves authoritative closed and exceptional day states', () => {
    expect(
      projectOperationsStatus({
        businessDayState: 'CLOSED',
        shiftStates: [],
        reconciliationStates: ['POSTED'],
        revisionStates: ['POSTED'],
      }),
    ).toEqual({ close: 'CLOSED', approval: 'POSTED' });
    expect(
      projectOperationsStatus({
        businessDayState: 'EXCEPTIONALLY_CLOSED',
        shiftStates: [],
        reconciliationStates: [],
        revisionStates: [],
      }),
    ).toEqual({ close: 'EXCEPTION', approval: 'NO_REVISION' });
  });
});
