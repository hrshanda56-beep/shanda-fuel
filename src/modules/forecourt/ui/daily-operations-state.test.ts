import { describe, expect, it } from 'vitest';
import {
  dailyOperationsStatusLabel,
  dailyOperationsStatusTone,
  isEditableDailyOperationsState,
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
