import { describe, expect, it } from 'vitest';
import { clientErrorMessage } from './client';

describe('clientErrorMessage', () => {
  it('keeps the real duplicate deposit reference message', () => {
    expect(
      clientErrorMessage({
        status: 409,
        code: 'CONFLICT',
        message: 'A bank deposit with this reference already exists',
        fallback: 'save failed',
      }),
    ).toBe('This deposit reference is already used.');
  });

  it('keeps validation detail and reserves connection wording for network failures', () => {
    expect(
      clientErrorMessage({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'Variance explanations are required for: SALES, CASH',
        fallback: 'save failed',
      }),
    ).toContain('Variance explanations');
    expect(clientErrorMessage({ fallback: 'save failed', network: true })).toContain('connection');
  });

  it('maps a duplicate supplier payment reference to the supplier-specific message', () => {
    expect(
      clientErrorMessage({
        status: 409,
        code: 'CONFLICT',
        message: 'A supplier payment with this reference already exists',
        fallback: 'save failed',
      }),
    ).toBe('A payment with this reference already exists for this supplier.');
  });

  it('maps step-up failures to a neutral, actionable message', () => {
    expect(
      clientErrorMessage({
        status: 403,
        code: 'STEP_UP_REQUIRED',
        fallback: 'save failed',
      }),
    ).toContain('confirm it’s you');
  });
});
