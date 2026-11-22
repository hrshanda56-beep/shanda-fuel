import { describe, expect, it } from 'vitest';
import {
  checkCompanyName,
  checkStationCode,
  checkStationCompany,
  checkStationName,
  suggestStationCode,
} from './structure-checks';

describe('structure checks', () => {
  it('asks for a company name that is not already used', () => {
    expect(checkCompanyName('  ').name).toBeTruthy();
    expect(checkCompanyName(' acme ', ['Acme']).name).toMatch(/already/);
    expect(checkCompanyName('Acme', [])).toEqual({});
  });

  it('asks for a station name and a company', () => {
    expect(checkStationName('').name).toBeTruthy();
    expect(checkStationName('Bindura')).toEqual({});
    expect(checkStationCompany('').company).toBeTruthy();
    expect(checkStationCompany('c1')).toEqual({});
  });

  it('accepts a 2 to 20 character code that is not taken', () => {
    expect(checkStationCode('B').code).toBeTruthy();
    expect(checkStationCode('has space').code).toBeTruthy();
    expect(checkStationCode('BND', ['bnd']).code).toMatch(/already/);
    expect(checkStationCode('BND', ['HRE'])).toEqual({});
  });

  it('suggests a short unused code from the name', () => {
    expect(suggestStationCode('Bindura Road')).toBe('BIN');
    expect(suggestStationCode('Bindura Road', ['BIN'])).toBe('BIN2');
    expect(suggestStationCode('A')).toBe('');
    expect(checkStationCode(suggestStationCode('Bindura Road'))).toEqual({});
  });
});
