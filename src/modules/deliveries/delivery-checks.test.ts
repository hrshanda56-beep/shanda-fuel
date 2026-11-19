import { describe, expect, it } from 'vitest';
import {
  checkDips,
  checkNote,
  checkReceived,
  checkSupplier,
  checkTank,
  checkWater,
} from './delivery-checks';

describe('delivery checks', () => {
  it('asks for a supplier and a tank', () => {
    expect(checkSupplier('')['rd-supplier']).toBeTruthy();
    expect(checkSupplier('s1')).toEqual({});
    expect(checkTank('')['rd-tank']).toBeTruthy();
    expect(checkTank('t1')).toEqual({});
  });

  it('asks for the note number, the time and the quantity on the note', () => {
    expect(Object.keys(checkNote('', '', ''))).toEqual([
      'rd-note-number',
      'rd-delivered-at',
      'rd-note-litres',
    ]);
    expect(checkNote('DN-1', '2026-11-19T08:00', '5000')).toEqual({});
    expect(checkNote('DN-1', 'nonsense', '5000')['rd-delivered-at']).toBeTruthy();
    expect(checkNote('DN-1', '2026-11-19T08:00', '5,000')['rd-note-litres']).toMatch(/number/);
  });

  it('accepts up to three decimals for the quantity received', () => {
    expect(checkReceived('4980.5')).toEqual({});
    expect(checkReceived('4980.5555')['rd-received-litres']).toBeTruthy();
    expect(checkReceived('')['rd-received-litres']).toMatch(/Enter/);
  });

  it('lets dips and the water reading be empty but not wrong', () => {
    expect(checkDips('', '')).toEqual({});
    expect(checkDips('abc', '')['rd-dip-before']).toBeTruthy();
    expect(checkDips('', '1200')).toEqual({});
    expect(checkWater('', 'x')).toEqual({});
    expect(checkWater('PASS', '')).toEqual({});
    expect(checkWater('FAIL', 'x')['rd-water-mm']).toBeTruthy();
  });
});
