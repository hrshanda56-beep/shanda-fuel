import { describe, it, expect } from 'vitest';
import { assertExpenseCorrectionAllowed, expenseVersionSnapshot } from './versioning';
const facts = {
  expenseId: 'expense',
  categoryId: 'category',
  expenseDate: '2026-10-19',
  description: 'Pump repair',
  payee: 'Mechanic',
  reference: 'R1',
  amount: '25.0000',
  currency: 'USD' as const,
  shiftId: 'shift',
  observedAt: '2026-10-19T10:00:00Z',
};
describe('unified expense versions', () => {
  it('preserves exact facts and optional shift without treating payment as expense data', () => {
    const version = expenseVersionSnapshot(facts, {
      versionNumber: 1,
      previousVersionId: null,
      actorId: 'supervisor',
      reason: 'Initial capture',
      lineage: 'COMPLETE',
    });
    expect(version.amount).toBe('25.0000');
    expect(version.shiftId).toBe('shift');
    expect(Object.isFrozen(version)).toBe(true);
    expect(version).not.toHaveProperty('paymentMethod');
  });
  it('allows correction only before approvals, settlement or submitted report use', () => {
    expect(() =>
      assertExpenseCorrectionAllowed({
        state: 'SUBMITTED',
        approvals: 0,
        payments: 0,
        submittedReportUses: 0,
        expectedVersionId: 'v1',
        currentVersionId: 'v1',
      }),
    ).not.toThrow();
    for (const changes of [
      { state: 'POSTED' },
      { approvals: 1 },
      { payments: 1 },
      { submittedReportUses: 1 },
      { currentVersionId: 'v2' },
    ])
      expect(() =>
        assertExpenseCorrectionAllowed({
          state: 'SUBMITTED',
          approvals: 0,
          payments: 0,
          submittedReportUses: 0,
          expectedVersionId: 'v1',
          currentVersionId: 'v1',
          ...changes,
        }),
      ).toThrow();
  });
  it('retains originals and rejects invalid correction provenance or imprecise money', () => {
    const v1 = expenseVersionSnapshot(facts, {
      versionNumber: 1,
      previousVersionId: null,
      actorId: 'a',
      reason: 'Initial',
      lineage: 'COMPLETE',
    });
    const v2 = expenseVersionSnapshot(
      { ...facts, amount: '30.0000' },
      {
        versionNumber: 2,
        previousVersionId: 'v1',
        actorId: 'b',
        reason: 'Receipt corrected',
        lineage: 'COMPLETE',
      },
    );
    expect(v1.amount).toBe('25.0000');
    expect(v2.amount).toBe('30.0000');
    expect(() =>
      expenseVersionSnapshot(facts, {
        versionNumber: 2,
        previousVersionId: null,
        actorId: 'b',
        reason: '',
        lineage: 'COMPLETE',
      }),
    ).toThrow();
    expect(() =>
      expenseVersionSnapshot(
        { ...facts, amount: '25.12345' },
        {
          versionNumber: 1,
          previousVersionId: null,
          actorId: 'a',
          reason: 'Initial',
          lineage: 'COMPLETE',
        },
      ),
    ).toThrow();
  });
  it('labels imported existing facts as a legacy snapshot without inventing earlier versions', () => {
    expect(
      expenseVersionSnapshot(
        { ...facts, shiftId: null, observedAt: null },
        {
          versionNumber: 1,
          previousVersionId: null,
          actorId: 'a',
          reason: 'Existing evidence snapshot',
          lineage: 'LEGACY_SNAPSHOT',
        },
      ).lineage,
    ).toBe('LEGACY_SNAPSHOT');
  });
});
