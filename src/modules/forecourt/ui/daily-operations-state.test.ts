import { describe, expect, it } from 'vitest';
import {
  dailyOperationsStatusLabel,
  dailyOperationsStatusTone,
  isEditableDailyOperationsState,
  dailyOperationsProblem,
  dailyOperationsLinkFix,
  mapDailyOperationsError,
} from './daily-operations-state';

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
    ).toEqual({ kind: 'step', label: 'Go to the explanations', step: 5 });
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

  it('adds no button when refreshing is the only remedy', () => {
    expect(problem(409, 'CONFLICT', 'stale').fix).toBeUndefined();
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
