import { describe, expect, it } from 'vitest';
import { assertCashCommandType } from './commands';

describe('cash command routing', () => {
  it('accepts the handover state-machine commands exposed to the operator UI', () => {
    expect(
      [
        'PrepareHandover',
        'SenderConfirmHandover',
        'ReceiverConfirmHandover',
        'ResolveHandoverDispute',
        'CancelHandover',
      ].map(assertCashCommandType),
    ).toEqual([
      'PrepareHandover',
      'SenderConfirmHandover',
      'ReceiverConfirmHandover',
      'ResolveHandoverDispute',
      'CancelHandover',
    ]);
  });

  it('rejects arbitrary status mutation commands', () => {
    expect(() => assertCashCommandType('UpdateCashHandoverStatus')).toThrow(
      'Unsupported cash command type',
    );
  });
});
