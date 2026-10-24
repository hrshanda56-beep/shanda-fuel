import { describe, expect, it } from 'vitest';
import { litresForReading, normaliseCalibrationChart, parseCalibrationText } from './calibration';

const chart = [
  { measurement: '0', litres: '0' },
  { measurement: '100', litres: '10000' },
  { measurement: '200', litres: '30000' },
];

describe('litresForReading', () => {
  it('reads exact chart rows', () => {
    expect(litresForReading(chart, '100')).toBe('10000');
    expect(litresForReading(chart, '0')).toBe('0');
    expect(litresForReading(chart, '200')).toBe('30000');
  });

  it('works between two rows in a straight line', () => {
    expect(litresForReading(chart, '50')).toBe('5000');
    expect(litresForReading(chart, '150')).toBe('20000');
    expect(litresForReading(chart, '112.5')).toBe('12500');
  });

  it('rounds to a thousandth of a litre and never uses floating point', () => {
    const odd = [
      { measurement: '0', litres: '0' },
      { measurement: '3', litres: '10' },
    ];
    expect(litresForReading(odd, '1')).toBe('3.333');
    expect(litresForReading(odd, '2')).toBe('6.667');
  });

  it('does not guess outside the chart', () => {
    expect(() => litresForReading(chart, '200.1')).toThrow(/outside this tank's chart/);
    expect(() => litresForReading(chart, '-1')).toThrow(/outside this tank's chart/);
  });

  it('accepts an unsorted chart', () => {
    expect(litresForReading([chart[2]!, chart[0]!, chart[1]!], '50')).toBe('5000');
  });
});

describe('normaliseCalibrationChart', () => {
  it('needs at least two rows', () => {
    expect(() => normaliseCalibrationChart([chart[0]!])).toThrow(/at least two rows/);
  });

  it('rejects a repeated reading and litres that go down', () => {
    expect(() =>
      normaliseCalibrationChart([chart[0]!, chart[1]!, { measurement: '100', litres: '11000' }]),
    ).toThrow(/more than once/);
    expect(() =>
      normaliseCalibrationChart([chart[0]!, chart[1]!, { measurement: '150', litres: '9000' }]),
    ).toThrow(/cannot hold fewer litres/);
  });

  it('rejects a chart bigger than the tank', () => {
    expect(() => normaliseCalibrationChart(chart, '25000')).toThrow(/more litres than the tank/);
    expect(normaliseCalibrationChart(chart, '30000')).toHaveLength(3);
  });

  it('rejects negatives and non-numbers', () => {
    expect(() =>
      normaliseCalibrationChart([chart[0]!, { measurement: '5', litres: '-1' }]),
    ).toThrow(/negative/);
    expect(() =>
      normaliseCalibrationChart([chart[0]!, { measurement: 'abc', litres: '1' }]),
    ).toThrow(/must be a number/);
  });
});

describe('parseCalibrationText', () => {
  it('reads one row per line with commas, spaces or tabs', () => {
    expect(parseCalibrationText('0, 0\n100 10000\n\n200\t30000\r\n')).toEqual([
      { measurement: '0', litres: '0' },
      { measurement: '100', litres: '10000' },
      { measurement: '200', litres: '30000' },
    ]);
  });

  it('points at the line that is wrong', () => {
    expect(() => parseCalibrationText('0,0\nhello\n')).toThrow(/Line 2/);
    expect(() => parseCalibrationText('1,2,3')).toThrow(/Line 1/);
  });
});
