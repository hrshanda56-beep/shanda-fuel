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
