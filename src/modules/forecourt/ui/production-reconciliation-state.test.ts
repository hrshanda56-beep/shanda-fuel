import { describe, expect, it } from 'vitest';
import { missingReconciliationEvidence } from './production-reconciliation-state';

const base = {
  attendantsCount: 1,
  salesVariance: '0.0000',
  cashVariance: '0.0000',
  stockVariance: {},
  requiresApproverNote: false,
  explanations: {},
};

describe('missingReconciliationEvidence', () => {
  it('requires only the evidence for non-zero persisted variances', () => {
    expect(
      missingReconciliationEvidence({
        ...base,
        salesVariance: '-10.0000',
        cashVariance: '2.0000',
        stockVariance: { tank: '4.000' },
      }),
    ).toEqual([
      'sales variance explanation',
      'cash variance explanation',
      'stock variance explanation',
    ]);
  });

  it('requires an approver note for a red variance and an attendant for submission', () => {
    expect(
      missingReconciliationEvidence({
        ...base,
        attendantsCount: 0,
        requiresApproverNote: true,
      }),
    ).toEqual(['at least one attendant', 'approver note for the red variance']);
  });

  it('clears a gate once the required explanations are present', () => {
    expect(
      missingReconciliationEvidence({
        ...base,
        salesVariance: '10.0000',
        cashVariance: '-2.0000',
        stockVariance: { tank: '-4.000' },
        requiresApproverNote: true,
        explanations: {
          SALES: 'Meter entry was corrected.',
          CASH: 'POS settlement arrived late.',
          STOCK: 'A late delivery was received.',
          APPROVER_NOTE: 'Management will investigate the variance.',
        },
      }),
    ).toEqual([]);
  });
});
