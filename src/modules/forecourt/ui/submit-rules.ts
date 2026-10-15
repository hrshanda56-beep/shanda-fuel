import type { UserMessageCode } from '../../../design-system/user-messages';

export const MIN_EXPLANATION = 10;

export type SubmitCheck = Readonly<{
  id: 'shift' | 'readings' | 'payments' | 'cash' | 'differences';
  label: string;
  ok: boolean;
}>;

export type SubmitEvaluation = Readonly<{
  checks: readonly SubmitCheck[];
  canSubmit: boolean;
  /** The first rule that fails, as the plain-language code and the one-line reason shown under the button. */
  blocked: Readonly<{ code: UserMessageCode; reason: string }> | null;
  /** Which differences still need an explanation. */
  unexplained: readonly ('SALES' | 'CASH' | 'STOCK')[];
}>;

const SHIFT_CLOSED = new Set(['METER_CLOSED', 'COMPLETED']);

/**
 * Whether a reconciliation may be submitted. The checklist on screen, the Submit button and the reason
 * under it all read this one result, so they can never disagree.
 */
export function evaluateSubmit(input: {
  shiftState: string;
  readingsComplete: boolean;
  hasPayments: boolean;
  cashCounted: boolean;
  /** Which differences exist (non-zero). */
  differences: Readonly<{ sales: boolean; cash: boolean; stock: boolean }>;
  explanations: Readonly<Record<string, string>>;
  offline?: boolean;
}): SubmitEvaluation {
  const unexplained = (['SALES', 'CASH', 'STOCK'] as const).filter((category) => {
    const needed =
      category === 'SALES'
        ? input.differences.sales
        : category === 'CASH'
          ? input.differences.cash
          : input.differences.stock;
    return needed && (input.explanations[category] ?? '').trim().length < MIN_EXPLANATION;
  });
  const shiftClosed = SHIFT_CLOSED.has(input.shiftState);
  const checks: SubmitCheck[] = [
    { id: 'shift', label: 'Shift meters are closed', ok: shiftClosed },
    { id: 'readings', label: 'Closing reading entered for every pump', ok: input.readingsComplete },
    { id: 'payments', label: 'How customers paid is entered', ok: input.hasPayments },
    { id: 'cash', label: 'Cash is counted', ok: input.cashCounted },
    { id: 'differences', label: 'Every difference is explained', ok: unexplained.length === 0 },
  ];

  let blocked: SubmitEvaluation['blocked'] = null;
  if (input.offline) {
    blocked = { code: 'UNKNOWN', reason: 'Connect to the internet to submit.' };
  } else if (!shiftClosed) {
    blocked = { code: 'SHIFT_NOT_CLOSED', reason: 'Close the shift meters, then submit the figures.' };
  } else if (!input.readingsComplete) {
    blocked = {
      code: 'METER_READINGS_MISSING',
      reason: 'Enter a closing reading for every pump before submitting.',
    };
  } else if (!input.hasPayments) {
    blocked = { code: 'UNKNOWN', reason: 'Add how customers paid before submitting.' };
  } else if (!input.cashCounted) {
    blocked = { code: 'UNKNOWN', reason: 'Count the cash before submitting.' };
  } else if (unexplained.length > 0) {
    blocked = {
      code: 'DIFFERENCE_NOT_EXPLAINED',
      reason: `Add a reason of at least ${MIN_EXPLANATION} characters for every difference.`,
    };
  }
  return { checks, canSubmit: blocked === null, blocked, unexplained };
}
