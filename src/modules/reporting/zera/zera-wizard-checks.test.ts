import { describe, expect, it } from 'vitest';
import { buildZeraReturn } from './zera-return';
import type { StationZeraDetails } from './zera-licence';
import {
  checkContact,
  checkLicenceDetails,
  checkLicenceNumber,
  monthName,
  neutraliseCell,
  recentMonths,
  zeraAnswers,
  zeraCsv,
  zeraDueDate,
  zeraSteps,
} from './zera-wizard-checks';

const empty: StationZeraDetails = {
  licenceNumber: null,
  licenceHolder: null,
  ownership: null,
  province: null,
  representativeName: null,
  representativePhone: null,
  representativeEmail: null,
};
const full: StationZeraDetails = {
  licenceNumber: 'L-77',
  licenceHolder: 'Triumph Energy (Pvt) Ltd',
  ownership: 'COCO',
  province: 'Harare',
  representativeName: 'Tendai',
  representativePhone: '+263 77 123 4567',
  representativeEmail: 'tendai@example.com',
};
const clean = buildZeraReturn({ supplied: [], sold: [], missingDays: [] });

describe('step order', () => {
  it('asks every licence question the first time', () => {
    expect(
      zeraSteps({ stationCount: 1, details: empty, result: clean, needsEthanol: false }),
    ).toEqual(['month', 'holder', 'number', 'ownership', 'province', 'contact', 'notes', 'review']);
  });

  it('goes straight to the figures once the licence is saved', () => {
    expect(
      zeraSteps({ stationCount: 2, details: full, result: clean, needsEthanol: false }),
    ).toEqual(['month', 'station', 'notes', 'review']);
  });

  it('keeps a question in the list while the person is changing it', () => {
    expect(
      zeraSteps({
        stationCount: 1,
        details: full,
        result: clean,
        answered: { holder: true },
        needsEthanol: false,
      }),
    ).toContain('holder');
  });

  it('adds ethanol and problems only when they apply', () => {
    const withGaps = buildZeraReturn({ supplied: [], sold: [], missingDays: ['2026-10-03'] });
    const steps = zeraSteps({
      stationCount: 1,
      details: full,
      result: withGaps,
      needsEthanol: true,
    });
    expect(steps).toEqual(['month', 'ethanol', 'problems', 'notes', 'review']);
  });
});

describe('checks', () => {
  const phone = '+263 77 123 4567';
  const email = 'tendai@example.com';

  it('needs a licence number, a believable phone number and an email address', () => {
    expect(checkLicenceNumber('  ').number).toBeTruthy();
    expect(checkLicenceNumber('L-77')).toEqual({});
    expect(checkContact('', phone, email).contactName).toBeTruthy();
    expect(checkContact('Tendai', 'abc', email).contactPhone).toBeTruthy();
    expect(checkContact('Tendai', '12', email).contactPhone).toBeTruthy();
    expect(checkContact('Tendai', phone, email)).toEqual({});
    expect(checkContact('Tendai', '(0242) 700-123', email)).toEqual({});
    expect(checkContact('Tendai', phone, 'no-at-sign').contactEmail).toBeTruthy();
    expect(checkContact('Tendai', phone, 'a@b').contactEmail).toBeTruthy();
    expect(checkContact('Tendai', phone, '').contactEmail).toBeTruthy();
  });

  it('accepts a full licence and names every missing answer', () => {
    expect(checkLicenceDetails(full)).toEqual({});
    const problems = checkLicenceDetails(empty);
    expect(Object.keys(problems).sort()).toEqual(
      [
        'contactEmail',
        'contactName',
        'contactPhone',
        'holder',
        'number',
        'ownership',
        'province',
      ].sort(),
    );
  });
});

describe('months', () => {
  it('lists the last full months, newest first, across a year end', () => {
    const months = recentMonths('2026-01-15', 3);
    expect(months.map((m) => m.value)).toEqual(['2025-12', '2025-11', '2025-10']);
    expect(months[0]?.label).toBe('December 2025');
    expect(recentMonths('2026-11-21', 1)[0]?.value).toBe('2026-10');
  });
});

describe('answers and csv', () => {
  const answers = zeraAnswers({
    month: '2026-10',
    details: full,
    ethanolPercent: 10,
    result: clean,
  });

  it('lists the fourteen answers in the order the ZERA form asks them', () => {
    expect(answers).toHaveLength(14);
    expect(answers.map((a) => a.value).slice(0, 8)).toEqual([
      'Tendai',
      '+263 77 123 4567',
      'tendai@example.com',
      'Triumph Energy (Pvt) Ltd',
      'COCO',
      'L-77',
      'October',
      'Harare',
    ]);
    // Supplied (diesel 50ppm, petrol, ethanol), then sold (diesel 50ppm, petrol), then notes.
    expect(answers.slice(8, 13).map((a) => a.value)).toEqual(['0', '0', '10', '0', '0']);
    expect(answers[13]?.label).toMatch(/^Notes/);
  });

  it('writes 0 for the ethanol percentage when there is no blend, never a blank', () => {
    const none = zeraAnswers({
      month: '2026-10',
      details: full,
      ethanolPercent: null,
      result: clean,
    });
    expect(none[10]?.value).toBe('0');
  });

  it('puts the system notes first and the typed notes after them', () => {
    const withNote = zeraAnswers({
      month: '2026-10',
      details: full,
      ethanolPercent: 0,
      result: buildZeraReturn({ supplied: [], sold: [], missingDays: ['2026-10-03'] }),
      extraNotes: '  Pump 2 was offline.  ',
    });
    expect(withNote[13]?.value).toContain('2026-10-03');
    expect(withNote[13]?.value.endsWith('Pump 2 was offline.')).toBe(true);
  });

  it('quotes csv values so commas and quotes survive', () => {
    expect(zeraCsv([{ label: 'Notes', value: 'He said "ok", fine' }])).toBe(
      'Question,Answer\r\n"Notes","He said ""ok"", fine"',
    );
  });

  it('defuses spreadsheet formulas but keeps phone numbers and plain numbers as they are', () => {
    expect(neutraliseCell('=HYPERLINK("x")')).toBe('\'=HYPERLINK("x")');
    expect(neutraliseCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutraliseCell('-1+2')).toBe("'-1+2");
    expect(neutraliseCell('+cmd|calc')).toBe("'+cmd|calc");
    expect(neutraliseCell('+263 77 123 4567')).toBe('+263 77 123 4567');
    expect(neutraliseCell('203402')).toBe('203402');
  });
});

describe('month name and due date', () => {
  it('names the month without a year, as the form does', () => {
    expect(monthName('2026-10')).toBe('October');
    expect(monthName('2026-01')).toBe('January');
  });

  it('is the 3rd of the next month, across a year end', () => {
    expect(zeraDueDate('2026-10')).toEqual({ value: '2026-11-03', label: '3 November 2026' });
    expect(zeraDueDate('2026-12')).toEqual({ value: '2027-01-03', label: '3 January 2027' });
  });
});
