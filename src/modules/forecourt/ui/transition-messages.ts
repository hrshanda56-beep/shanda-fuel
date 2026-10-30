/** What a person is told once a reconciliation moves on, so every screen that does it says the same. */
export const TRANSITION_SUCCESS: Record<string, string> = {
  SubmitProductionReconciliation:
    'Submitted for review. A manager can now check these figures. You cannot change them unless they are returned to you.',
  ReturnProductionReconciliation:
    'Returned for corrections. The supervisor can fix the figures and submit again.',
  ApproveProductionReconciliation: 'Approved and locked. The sales are now recorded.',
};
