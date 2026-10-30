import { describe, expect, it } from 'vitest';
import { findMissingReportDays } from './missing-report-days';

const station = {
  stationId: 'st-1',
  goLiveDate: '2026-10-20',
  expectedShifts: ['DAY', 'NIGHT'],
};

const submitted = (date: string, shifts: string[]) =>
  shifts.map((shiftTemplate) => ({ stationId: 'st-1', businessDate: date, shiftTemplate }));

describe('findMissingReportDays', () => {
  it('flags gap days with no submitted shift at all (the 24 to 28 Oct case)', () => {
    const result = findMissingReportDays({
      stations: [station],
      today: '2026-10-29',
      lateAfterDays: 0,
      submitted: [
        ...submitted('2026-10-20', ['DAY', 'NIGHT']),
        ...submitted('2026-10-21', ['DAY', 'NIGHT']),
        ...submitted('2026-10-22', ['DAY', 'NIGHT']),
        ...submitted('2026-10-23', ['DAY', 'NIGHT']),
      ],
    });
    expect(result.map((day) => day.businessDate)).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
    ]);
    expect(result.every((day) => day.missingShifts.length === 2)).toBe(true);
  });

  it('flags a day when only one of the expected shifts was submitted', () => {
    const result = findMissingReportDays({
      stations: [station],
      today: '2026-10-22',
      lateAfterDays: 0,
      submitted: [
        ...submitted('2026-10-20', ['DAY', 'NIGHT']),
        ...submitted('2026-10-21', ['DAY']),
      ],
    });
    expect(result).toEqual([
      { stationId: 'st-1', businessDate: '2026-10-21', missingShifts: ['NIGHT'] },
    ]);
  });

  it('never flags today, and respects the late-after grace period', () => {
    const input = {
      stations: [station],
      today: '2026-10-22',
      submitted: submitted('2026-10-20', ['DAY', 'NIGHT']),
    };
    expect(
      findMissingReportDays({ ...input, lateAfterDays: 0 }).map((d) => d.businessDate),
    ).toEqual(['2026-10-21']);
    expect(findMissingReportDays({ ...input, lateAfterDays: 1 })).toEqual([]);
  });

  it('does not look before the station go-live date', () => {
    const result = findMissingReportDays({
      stations: [{ ...station, goLiveDate: '2026-10-28' }],
      today: '2026-10-29',
      lateAfterDays: 0,
      submitted: [],
    });
    expect(result.map((day) => day.businessDate)).toEqual(['2026-10-28']);
  });

  it('expects at least one submitted report a day when a station has no shift templates', () => {
    const result = findMissingReportDays({
      stations: [{ ...station, expectedShifts: [] }],
      today: '2026-10-23',
      lateAfterDays: 0,
      submitted: [{ stationId: 'st-1', businessDate: '2026-10-21', shiftTemplate: 'ANY' }],
    });
    expect(result.map((day) => day.businessDate)).toEqual(['2026-10-20', '2026-10-22']);
  });

  it('keeps stations apart', () => {
    const result = findMissingReportDays({
      stations: [station, { ...station, stationId: 'st-2' }],
      today: '2026-10-21',
      lateAfterDays: 0,
      submitted: [
        { stationId: 'st-1', businessDate: '2026-10-20', shiftTemplate: 'DAY' },
        { stationId: 'st-1', businessDate: '2026-10-20', shiftTemplate: 'NIGHT' },
        { stationId: 'st-2', businessDate: '2026-10-20', shiftTemplate: 'DAY' },
      ],
    });
    expect(result).toEqual([
      { stationId: 'st-2', businessDate: '2026-10-20', missingShifts: ['NIGHT'] },
    ]);
  });
});
