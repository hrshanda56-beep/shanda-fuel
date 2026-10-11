import { describe, expect, it } from 'vitest';

import { eventLabel, isEarlierOpenDay } from './operations-labels';

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

describe('isEarlierOpenDay', () => {
  it('flags an open day only when it is before the station business date', () => {
    expect(isEarlierOpenDay({ state: 'OPEN', date: '2026-10-08' }, '2026-10-11')).toBe(true);
    expect(isEarlierOpenDay({ state: 'OPEN', date: '2026-10-11' }, '2026-10-11')).toBe(false);
    expect(isEarlierOpenDay({ state: 'CLOSED', date: '2026-10-08' }, '2026-10-11')).toBe(false);
    expect(isEarlierOpenDay(null, '2026-10-11')).toBe(false);
  });

  it('compares across month and year ends as dates', () => {
    expect(isEarlierOpenDay({ state: 'OPEN', date: '2026-09-30' }, '2026-10-01')).toBe(true);
    expect(isEarlierOpenDay({ state: 'OPEN', date: '2026-12-31' }, '2027-01-01')).toBe(true);
  });
});
