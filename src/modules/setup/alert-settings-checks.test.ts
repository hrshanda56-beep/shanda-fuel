import { describe, expect, it } from 'vitest';
import {
  OTHER,
  checkDueSoon,
  checkGrace,
  checkMinimum,
  checkPosLag,
  choiceFor,
  cleanMinimum,
  daysLabel,
} from './alert-settings-checks';

describe('reminder checks', () => {
  it('keeps each number of days in its range', () => {
    expect(checkDueSoon('0')).toHaveProperty('alert-due-soon');
    expect(checkDueSoon('61')).toHaveProperty('alert-due-soon');
    expect(checkDueSoon('7')).toEqual({});
    expect(checkPosLag('0')).toEqual({});
    expect(checkPosLag('31')).toHaveProperty('alert-pos-lag');
    expect(checkGrace('14')).toEqual({});
    expect(checkGrace('15')).toHaveProperty('alert-grace');
    expect(checkGrace('1.5')).toHaveProperty('alert-grace');
    expect(checkGrace('')).toHaveProperty('alert-grace');
  });

  it('reads the shortage amount as an exact number', () => {
    expect(checkMinimum('')).toHaveProperty('alert-cash-minimum');
    expect(checkMinimum('-1')).toHaveProperty('alert-cash-minimum');
    expect(checkMinimum('5')).toEqual({});
    expect(checkMinimum('2.5')).toEqual({});
    expect(cleanMinimum(' 1,000.50 ')).toBe('1000.50');
  });

  it('shows a usual answer when the value is one, otherwise "other"', () => {
    expect(choiceFor('dueSoon', '7')).toBe('7');
    expect(choiceFor('dueSoon', ' 7 ')).toBe('7');
    expect(choiceFor('dueSoon', '9')).toBe(OTHER);
    expect(choiceFor('minimum', '5')).toBe('5');
  });

  it('says days in plain words', () => {
    expect(daysLabel(1)).toBe('1 day');
    expect(daysLabel('7')).toBe('7 days');
    expect(daysLabel(0)).toBe('0 days');
  });
});
