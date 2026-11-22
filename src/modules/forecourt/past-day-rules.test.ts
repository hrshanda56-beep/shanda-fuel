import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, missingPastDays, refusePastDay } from './past-day-rules';

const base = {
  today: '2026-11-22',
  goLiveDate: null,
  canGoBeyondSupervisorWindow: false,
  existingDates: new Set<string>(),
};

describe('past-day dates', () => {
  it('counts whole days and rejects things that are not dates', () => {
    expect(daysBetween('2026-11-15', '2026-11-22')).toBe(7);
    expect(daysBetween('2026-02-30', '2026-03-01')).toBeNull();
    expect(daysBetween('22/11/2026', '2026-11-22')).toBeNull();
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('refusePastDay', () => {
  it('accepts yesterday and a day a week ago for a supervisor', () => {
    expect(refusePastDay({ ...base, date: '2026-11-21' })).toBeNull();
    expect(refusePastDay({ ...base, date: '2026-11-15' })).toBeNull();
  });

  it('refuses today, the future and non-dates', () => {
    expect(refusePastDay({ ...base, date: '2026-11-22' })?.code).toBe('NOT_IN_THE_PAST');
    expect(refusePastDay({ ...base, date: '2026-11-23' })?.code).toBe('NOT_IN_THE_PAST');
    expect(refusePastDay({ ...base, date: 'last week' })?.code).toBe('BAD_DATE');
  });

  it('sends a supervisor to the owner beyond 7 days, and lets the owner go to 90', () => {
    expect(refusePastDay({ ...base, date: '2026-11-14' })?.code).toBe('NEEDS_OWNER');
    expect(
      refusePastDay({ ...base, date: '2026-11-14', canGoBeyondSupervisorWindow: true }),
    ).toBeNull();
    expect(
      refusePastDay({ ...base, date: '2026-08-24', canGoBeyondSupervisorWindow: true }),
    ).toBeNull();
    expect(
      refusePastDay({ ...base, date: '2026-08-23', canGoBeyondSupervisorWindow: true })?.code,
    ).toBe('TOO_FAR_BACK');
  });

  it('refuses days before go-live and days that already exist', () => {
    expect(refusePastDay({ ...base, date: '2026-11-18', goLiveDate: '2026-11-19' })?.code).toBe(
      'BEFORE_GO_LIVE',
    );
    expect(refusePastDay({ ...base, date: '2026-11-19', goLiveDate: '2026-11-19' })).toBeNull();
    expect(
      refusePastDay({ ...base, date: '2026-11-20', existingDates: new Set(['2026-11-20']) })?.code,
    ).toBe('ALREADY_EXISTS');
  });
});

describe('missingPastDays', () => {
  it('lists the gaps oldest first, within the reach of the person', () => {
    const days = missingPastDays({
      ...base,
      existingDates: new Set(['2026-11-20', '2026-11-21']),
    });
    expect(days).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
  });

  it('starts at go-live and gives the owner the longer reach', () => {
    const days = missingPastDays({
      ...base,
      canGoBeyondSupervisorWindow: true,
      goLiveDate: '2026-11-10',
    });
    expect(days[0]).toBe('2026-11-10');
    expect(days.at(-1)).toBe('2026-11-21');
    expect(days).toHaveLength(12);
  });
});
