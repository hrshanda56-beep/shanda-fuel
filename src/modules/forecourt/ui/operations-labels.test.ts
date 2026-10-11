import { describe, expect, it } from 'vitest';

import { eventLabel } from './operations-labels';

describe('eventLabel', () => {
  it.each([
    ['FORECOURT.OpenBusinessDay', 'Open business day'],
    ['FORECOURT.CloseMeters', 'Close meters'],
    ['StartShift', 'Start shift'],
    ['RECONCILIATION_SUBMITTED', 'Reconciliation submitted'],
    ['', 'Recorded action'],
  ])('labels %s as %s', (code, label) => {
    expect(eventLabel(code)).toBe(label);
  });
});
