import { describe, expect, it } from 'vitest';
import { createDraftSaveAttemptId, draftSaveCommandKey } from './daily-operations-save';

describe('daily operations save idempotency lifecycle', () => {
  it('keeps retries stable within an attempt and separates later saves', () => {
    const firstAttempt = createDraftSaveAttemptId();
    const firstKey = draftSaveCommandKey({
      reconciliationId: 'reconciliation-1',
      saveAttemptId: firstAttempt,
      commandIndex: 1,
      commandType: 'SaveMeterReadings',
    });
    const retryKey = draftSaveCommandKey({
      reconciliationId: 'reconciliation-1',
      saveAttemptId: firstAttempt,
      commandIndex: 1,
      commandType: 'SaveMeterReadings',
    });
    const secondAttempt = createDraftSaveAttemptId();
    const secondKey = draftSaveCommandKey({
      reconciliationId: 'reconciliation-1',
      saveAttemptId: secondAttempt,
      commandIndex: 1,
      commandType: 'SaveMeterReadings',
    });

    expect(firstKey).toBe(retryKey);
    expect(secondAttempt).not.toBe(firstAttempt);
    expect(secondKey).not.toBe(firstKey);
  });
});
