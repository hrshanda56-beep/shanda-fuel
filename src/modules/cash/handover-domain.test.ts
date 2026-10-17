import { describe, expect, it } from 'vitest';
import {
  applyCashHandoverCommand,
  cancelHandover,
  disputeHandover,
  prepareHandover,
  receiverConfirmHandover,
  resolveHandoverDispute,
  senderConfirmHandover,
  validateCashHandover,
} from './handover-domain';

describe('cash handover domain', () => {
  it('creates a draft with an exact positive monetary amount', () => {
    expect(prepareHandover({ deliveredBy: 'sender-1', expectedAmount: '100.1000' })).toEqual({
      state: 'DRAFT',
      deliveredBy: 'sender-1',
      receivedBy: null,
      expectedAmount: '100.1',
      countedAmount: null,
      variance: null,
      varianceExplanation: null,
      disputeReason: null,
      resolutionReason: null,
      cancellationReason: null,
    });
  });

  it('rejects amounts outside the cash schema scale instead of rounding them', () => {
    expect(() => prepareHandover({ deliveredBy: 'sender-1', expectedAmount: '1.00001' })).toThrow(
      'monetary decimal string',
    );
  });

  it('submits an exact zero-variance handover and accepts it only with a receiver', () => {
    const submitted = senderConfirmHandover(
      prepareHandover({ deliveredBy: 'sender-1', expectedAmount: '100.10' }),
      { countedAmount: '100.10' },
    );
    expect(submitted).toMatchObject({ state: 'SUBMITTED', variance: '0' });

    const accepted = receiverConfirmHandover(submitted, { receivedBy: 'receiver-1' });
    expect(accepted).toMatchObject({ state: 'ACCEPTED', receivedBy: 'receiver-1' });
  });

  it('requires a variance explanation for a non-zero exact variance', () => {
    const draft = prepareHandover({ deliveredBy: 'sender-1', expectedAmount: '100.10' });
    expect(() => senderConfirmHandover(draft, { countedAmount: '98.50' })).toThrow(
      'variance explanation is required',
    );

    const submitted = senderConfirmHandover(draft, {
      countedAmount: '98.50',
      varianceExplanation: 'Two notes were not included in the count',
    });
    expect(submitted).toMatchObject({
      state: 'SUBMITTED',
      variance: '-1.6',
      varianceExplanation: 'Two notes were not included in the count',
    });
    expect(() => receiverConfirmHandover(submitted, { receivedBy: 'receiver-1' })).toThrow(
      'must be disputed',
    );
  });

  it('requires a dispute reason and preserves the signed variance explanation', () => {
    const submitted = senderConfirmHandover(
      prepareHandover({ deliveredBy: 'sender-1', expectedAmount: '100.10' }),
      { countedAmount: '98.50', varianceExplanation: 'Counted amount is short' },
    );

    expect(() => disputeHandover(submitted, { receivedBy: 'receiver-1', reason: '   ' })).toThrow(
      'dispute reason is required',
    );

    const disputed = disputeHandover(submitted, {
      receivedBy: 'receiver-1',
      reason: 'Receiver count differs from sender declaration',
    });
    expect(disputed).toMatchObject({
      state: 'DISPUTED',
      variance: '-1.6',
      varianceExplanation: 'Counted amount is short',
      disputeReason: 'Receiver count differs from sender declaration',
    });
  });

  it('requires a resolution reason and reaches the resolved terminal state', () => {
    const disputed = disputeHandover(
      senderConfirmHandover(
        prepareHandover({ deliveredBy: 'sender-1', expectedAmount: '100.00' }),
        { countedAmount: '99.00', varianceExplanation: 'One dollar was held back for recount' },
      ),
      { receivedBy: 'receiver-1', reason: 'Recount required' },
    );

    expect(() => resolveHandoverDispute(disputed, { reason: '   ' })).toThrow(
      'resolution reason is required',
    );
    const resolved = resolveHandoverDispute(disputed, {
      reason: 'Shortage logged for supervisor review',
    });
    expect(resolved).toMatchObject({
      state: 'RESOLVED',
      resolutionReason: 'Shortage logged for supervisor review',
    });
    expect(() => cancelHandover(resolved, { reason: 'Too late' })).toThrow('RESOLVED state');
  });

  it('requires cancellation reasons and allows cancellation only before resolution', () => {
    const draft = prepareHandover({ deliveredBy: 'sender-1', expectedAmount: '50' });
    expect(() => cancelHandover(draft, { reason: '' })).toThrow('cancellation reason is required');
    expect(cancelHandover(draft, { reason: 'Duplicate handover draft' })).toMatchObject({
      state: 'CANCELLED',
      cancellationReason: 'Duplicate handover draft',
    });
  });

  it('validates loaded records and exposes named command transitions', () => {
    const draft = applyCashHandoverCommand(null, {
      type: 'PrepareHandover',
      deliveredBy: 'sender-1',
      expectedAmount: '25.25',
    });
    const confirmed = applyCashHandoverCommand(draft, {
      type: 'SenderConfirmHandover',
      countedAmount: '25.25',
    });
    validateCashHandover(confirmed);
    expect(() =>
      applyCashHandoverCommand(confirmed, {
        type: 'PrepareHandover',
        deliveredBy: 'x',
        expectedAmount: '1',
      }),
    ).toThrow('only create a new');
  });

  it('rejects a tampered variance without using binary floating point', () => {
    const submitted = senderConfirmHandover(
      prepareHandover({ deliveredBy: 'sender-1', expectedAmount: '0.30' }),
      { countedAmount: '0.10', varianceExplanation: 'Counted notes' },
    );
    expect(submitted.variance).toBe('-0.2');
    expect(() => validateCashHandover({ ...submitted, variance: '-0.19999999999999998' })).toThrow(
      'variance must equal',
    );
  });
});
