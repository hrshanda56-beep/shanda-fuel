import { describe, expect, it } from 'vitest';
import {
  dailyOperationsStatusLabel,
  dailyOperationsStatusTone,
  isEditableDailyOperationsState,
  dailyOperationsProblem,
  dailyOperationsLinkFix,
  mapDailyOperationsError,
  liveLitresSold,
  liveCashFigures,
  stepTitle,
} from './daily-operations-state';

describe('liveLitresSold', () => {
  it('is closing minus opening, exactly', () => {
    expect(liveLitresSold('65000', '100000')).toBe('35000.00');
    expect(liveLitresSold('100.125', '100.5')).toBe('0.375');
  });

  it('waits until both readings are numbers', () => {
    expect(liveLitresSold('65000', '')).toBeNull();
    expect(liveLitresSold('', '100')).toBeNull();
    expect(liveLitresSold('65000', '10x')).toBeNull();
  });

  it('goes negative when the closing is below the opening', () => {
    expect(liveLitresSold('500', '400')).toBe('-100.00');
  });
});

describe('liveCashFigures', () => {
  const payments = [
    { method: 'CASH', amount: '40000.00' },
    { method: 'CASH', amount: '5000' },
    { method: 'CARD', amount: '9000.00' },
    { method: 'CASH', amount: '' },
  ];
  const expenses = [
    { paymentMethod: 'CASH', amount: '1000.50' },
    { paymentMethod: 'BANK', amount: '700.00' },
  ];

  it('adds only cash payments, takes off only cash paid out, and compares to the count', () => {
    expect(liveCashFigures(payments, expenses, '50000')).toEqual({
      expected: '45000.00',
      paidOut: '1000.50',
      net: '43999.50',
      difference: '6000.50',
    });
  });

  it('waits for the count before showing a difference', () => {
    expect(liveCashFigures(payments, expenses, '').difference).toBeNull();
    expect(liveCashFigures(payments, expenses, 'abc').difference).toBeNull();
  });

  it('shows zeros when nothing has been entered', () => {
    expect(liveCashFigures([], [], '0')).toEqual({
      expected: '0.00',
      paidOut: '0.00',
      net: '0.00',
      difference: '0.00',
    });
  });

  it('is negative when less cash was counted than expected', () => {
    expect(liveCashFigures(payments, [], '44000').difference).toBe('-1000.00');
  });
});

describe('daily operations state mapping', () => {
  it('keeps returned revisions editable and approved revisions locked', () => {
    expect(isEditableDailyOperationsState('DRAFT')).toBe(true);
    expect(isEditableDailyOperationsState('RETURNED')).toBe(true);
    expect(isEditableDailyOperationsState('SUBMITTED')).toBe(false);
    expect(isEditableDailyOperationsState('APPROVED')).toBe(false);
  });

  it('communicates workflow state without relying on colour', () => {
    expect(dailyOperationsStatusTone('SUBMITTED')).toBe('pending');
    expect(dailyOperationsStatusTone('APPROVED')).toBe('locked');
    expect(dailyOperationsStatusLabel('PENDING_APPROVAL')).toBe('Pending Approval');
  });

  it('translates expected API failures into operational language', () => {
    expect(mapDailyOperationsError(409, 'CONFLICT', 'stale')).toContain('changed elsewhere');
    expect(mapDailyOperationsError(403, 'FORBIDDEN', 'no')).toContain('permission');
    expect(
      mapDailyOperationsError(
        400,
        'VALIDATION_FAILED',
        'Closing meter reading cannot be below opening',
      ),
    ).toContain('closing');
    expect(
      mapDailyOperationsError(
        409,
        'CONFLICT',
        'A canonical sale cannot be posted from an UNVALUED inventory stream',
      ),
    ).toContain('Inventory → Valuation');
  });
});

describe('daily operations problems', () => {
  const problem = dailyOperationsProblem;

  it('keeps the specific reason for a credit sale that cannot go ahead, and links to the customer', () => {
    const result = problem(
      409,
      'CONFLICT',
      'This would put Acme over their credit limit. Record a payment first, or ask a manager to approve a higher limit on the customer’s page.',
    );
    expect(result.message).toContain('credit limit');
    expect(result.message).not.toContain('changed elsewhere');
    expect(result.fix).toEqual({
      kind: 'link',
      label: 'Open customer accounts',
      href: '/customers',
    });
  });

  it('points an inactive selling price to the price change page', () => {
    const result = problem(409, 'CONFLICT', 'The selling price is not active for this product');
    expect(result.message).not.toContain('changed elsewhere');
    expect(result.fix).toEqual({
      kind: 'link',
      label: 'Set the selling price',
      href: '/operations/daily/price-change',
    });
  });

  it('takes the person to the step where the problem can be fixed', () => {
    expect(
      problem(400, 'VALIDATION_FAILED', 'Closing meter reading cannot be below opening reading')
        .fix,
    ).toEqual({ kind: 'step', label: 'Go to pump readings', step: 1 });
    expect(
      problem(400, 'VALIDATION_FAILED', 'Variance explanations are required for: cash, fuel').fix,
    ).toEqual({ kind: 'step', label: 'Go to the explanations', step: 6 });
    expect(
      problem(
        422,
        'VALIDATION_FAILED',
        'Tank T1 has no dip reading for this shift. Record a dip for it on the Tank dips step, then submit.',
      ).fix,
    ).toEqual({ kind: 'step', label: 'Go to tank dips', step: 5 });
    expect(
      problem(
        400,
        'VALIDATION_FAILED',
        'Select at least one attendant before submitting this reconciliation.',
      ).fix,
    ).toEqual({ kind: 'step', label: 'Choose the team', step: 0 });
    expect(
      problem(400, 'VALIDATION_FAILED', 'Choose the customer for this credit sale.').fix,
    ).toEqual({ kind: 'step', label: 'Go to payments', step: 2 });
  });

  it('says who has to act when the person who submitted tries to approve', () => {
    const result = problem(
      403,
      'FORBIDDEN',
      'The person who submitted a reconciliation cannot approve it',
    );
    expect(result.message).not.toContain('permission for this station action');
    expect(result.message).toContain('someone else');
  });

  it('does not show internal wording', () => {
    const bridge = problem(
      409,
      'DEPENDENCY_UNAVAILABLE',
      'The A12.1 reconciliation meter-segment bridge is not installed',
    );
    expect(bridge.message).not.toMatch(/A12|bridge|segment/i);
    const tanks = problem(
      409,
      'CONFLICT',
      'A reconciliation sale requires an explicit pump-to-tank mapping when a product has multiple active tanks',
    );
    expect(tanks.message).not.toMatch(/mapping/i);
    expect(tanks.fix).toEqual({ kind: 'link', label: 'Open tanks', href: '/inventory/tanks' });
  });

  it('offers sign-in again when the session has ended, and valuation when stock is unvalued', () => {
    expect(problem(401, 'UNAUTHENTICATED', undefined).fix).toEqual({
      kind: 'link',
      label: 'Sign in again',
      href: '/login',
    });
    expect(
      problem(
        409,
        'CONFLICT',
        'A canonical sale cannot be posted from an UNVALUED inventory stream',
      ).fix,
    ).toEqual({ kind: 'link', label: 'Open inventory valuation', href: '/inventory/valuation' });
  });

  it('explains an open shift in plain words instead of calling it a stale state', () => {
    const result = problem(
      409,
      'CONFLICT',
      'Every operated shift must be completed with authoritative sealed meter-close evidence, or explicitly marked NOT_OPERATED',
    );
    expect(result.message).toContain('Close the meters');
    expect(result.message).not.toMatch(/sealed|NOT_OPERATED|changed elsewhere/);
  });

  it('says in plain words what to do when no pump readings were submitted', () => {
    const result = problem(
      409,
      'CONFLICT',
      'Every operated shift requires sealed meter segments and an authoritative terminal meter-close boundary for each participating nozzle',
    );
    expect(result.message).toContain('Close Shift again');
    expect(result.message).toContain('submit');
    expect(result.message).not.toMatch(/segment|nozzle|boundary|changed elsewhere/i);
  });

  it('keeps the reason the server gives for a shift that cannot be closed', () => {
    const reason =
      'This shift cannot be closed yet: the opening reading for pump 1 nozzle 1 (900) is not where that meter last closed (1000). Correct the opening reading on the Pump readings step, then press Close Shift again.';
    const result = problem(409, 'CONFLICT', reason);
    expect(result.message).toBe(reason);
    expect(result.message).not.toContain('changed elsewhere');
  });

  it('tells a manager to have the shift closed first when approval finds no closed meters', () => {
    const result = problem(
      409,
      'CONFLICT',
      'The reconciliation reading has no matching sealed meter-segment evidence',
    );
    expect(result.message).toContain('Close Shift');
    expect(result.message).not.toMatch(/segment|evidence|changed elsewhere/i);
  });

  it('says the readings changed after the shift was closed when approval finds a mismatch', () => {
    const result = problem(
      409,
      'CONFLICT',
      'The last sealed meter segment does not match the reconciliation closing reading',
    );
    expect(result.message).toContain('changed after this shift was closed');
    expect(result.message).not.toMatch(/segment|changed elsewhere/i);
  });

  it('adds no button when refreshing is the only remedy', () => {
    expect(problem(409, 'CONFLICT', 'stale').fix).toBeUndefined();
  });
});

describe('stepTitle: the review says what it is (C1)', () => {
  it('keeps the supervisor’s titles for the person entering the figures', () => {
    expect(stepTitle(0, false)).toBe('Who is on shift?');
    expect(stepTitle(6, false)).toBe('Check and submit');
  });

  it('gives management a review, not a form to fill in', () => {
    expect(stepTitle(0, true)).toBe('Review: who worked this shift');
    expect(stepTitle(1, true)).toBe('Review: pump readings');
    expect(stepTitle(5, true)).toBe('Review: tank dips and deliveries');
    expect(stepTitle(6, true)).toBe('Approve or send back');
    for (let step = 0; step < 7; step += 1) {
      expect(stepTitle(step, true)).not.toMatch(/submit|tick|add an/i);
    }
  });
});

describe('daily operations link fix from message text', () => {
  it('returns a page link only, never a step of the workspace', () => {
    expect(dailyOperationsLinkFix('The selling price is not active for this product')?.href).toBe(
      '/operations/daily/price-change',
    );
    expect(dailyOperationsLinkFix('Closing meter reading cannot be below opening')).toBeUndefined();
    expect(dailyOperationsLinkFix(undefined)).toBeUndefined();
  });
});
