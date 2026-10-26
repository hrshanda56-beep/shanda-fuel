import { describe, expect, it } from 'vitest';

import { compartmentSumProblem, shortageOrExcess } from './record-delivery';

const row = (number: number, note: string, received: string) => ({
  number,
  noteLitres: note,
  receivedLitres: received,
  seals: '',
});

describe('shortageOrExcess', () => {
  it('shows the 17 litre shortage of a 5,000 litre note with 4,983 received', () => {
    expect(shortageOrExcess('5000', '4983')).toEqual({
      kind: 'SHORT',
      litres: '17',
      text: 'Shortage of 17 litres against the delivery note.',
    });
  });

  it('shows an excess and an exact match', () => {
    expect(shortageOrExcess('5000', '5000.5')?.kind).toBe('OVER');
    expect(shortageOrExcess('5000', '5000.5')?.litres).toBe('0.5');
    expect(shortageOrExcess('5000', '5000')?.kind).toBe('EXACT');
  });

  it('says nothing until both figures are numbers', () => {
    expect(shortageOrExcess('', '100')).toBeNull();
    expect(shortageOrExcess('100', 'abc')).toBeNull();
  });
});

describe('compartmentSumProblem', () => {
  it('is fine with no compartments or compartments that add up', () => {
    expect(compartmentSumProblem([], '5000', '4983')).toBeNull();
    expect(
      compartmentSumProblem([row(1, '3000', '2990'), row(2, '2000', '1993')], '5000', '4983'),
    ).toBeNull();
  });

  it('names the mismatch on the note and on the litres received', () => {
    expect(compartmentSumProblem([row(1, '3000', '2990')], '5000', '4983')).toMatch(
      /add up to 3000 litres on the note, but the delivery note says 5000/,
    );
    expect(compartmentSumProblem([row(1, '5000', '4000')], '5000', '4983')).toMatch(
      /add up to 4000 litres received, but you said 4983/,
    );
  });

  it('asks for both litres on a half-filled compartment', () => {
    expect(compartmentSumProblem([row(1, '5000', '')], '5000', '4983')).toMatch(/Compartment 1/);
  });
});
