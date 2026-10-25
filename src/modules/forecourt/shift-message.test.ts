import { describe, expect, it } from 'vitest';
import { parseShiftMessage } from './shift-message';

// The supervisor's message for 21/10/26 exactly as it arrived, WhatsApp stars and all.
const MESSAGE = `*21/10/26* 
 *Day Shift

*PETROL SALES* 
P*Price* $2.06

*Digital Pump Readings*
 
*PETROL PUMP
*A1*
Closing :40135.85
Opening:39414.08
Ltrs: 721.77

B1
Closing:115983.42
Opening:115125.51
Ltrs:857.91


*Total litres sold*
  1579.68


_____________________________________________
*DIESEL PUMP*
*PRICES* =2.06

*Digital Pump Readings*

*Pump 
*A1*
Closing  :230170.28
Opening :229387.82
  Ltrs.  :782.45


*B1*
Closing  :99391.38
Opening:97632.26
Ltrs    :1759.12




*Total litres sold* 
    2541.57
     



*Expenses* 
   
   Food 6
Bricks 100
Transport15
Total8369
Drop-2673



*Available Cash* 
*USD* $5696
 

 

*Excess/Shortfal*=

 

*Site Dips* 
Petrol 
Open : 1186mm-7394Ltr
Close : 936mm-5794ltrs

Diesel 
Opening:1390mm-8722L
Closing:998mm-6219Lt

 *Attendants*: judie n mugabe

*Superviser*: leon



*Available Cash* $5696

Total Litres sold
Petrol-1579.68 Ltrs
Diesel-2541.57Ltrs`;

describe('parseShiftMessage', () => {
  const parsed = parseShiftMessage(MESSAGE);

  it('reads the header, people and cash', () => {
    expect(parsed.date).toBe('2026-10-21');
    expect(parsed.shift).toBe('Day');
    expect(parsed.attendants).toBe('judie n mugabe');
    expect(parsed.supervisor).toBe('leon');
    expect(parsed.availableCash).toBe('5696');
    expect(parsed.cashDrop).toBe('2673');
  });

  it('reads every pump with exact readings', () => {
    expect(parsed.petrol.price).toBe('2.06');
    expect(parsed.petrol.pumps).toEqual([
      { label: 'A1', opening: '39414.08', closing: '40135.85', litres: '721.77' },
      { label: 'B1', opening: '115125.51', closing: '115983.42', litres: '857.91' },
    ]);
    expect(parsed.petrol.totalLitres).toBe('1579.68');
    expect(parsed.diesel.price).toBe('2.06');
    expect(parsed.diesel.pumps.map((pump) => pump.label)).toEqual(['A1', 'B1']);
    expect(parsed.diesel.totalLitres).toBe('2541.57');
  });

  it('reads expenses, leaving the total and the cash drop out of the list', () => {
    expect(parsed.expenses).toEqual([
      { description: 'Food', amount: '6' },
      { description: 'Bricks', amount: '100' },
      { description: 'Transport', amount: '15' },
    ]);
    expect(parsed.statedExpenseTotal).toBe('8369');
  });

  it('reads the tank dips in millimetres and litres', () => {
    expect(parsed.dips.petrol).toEqual({
      opening: { mm: '1186', litres: '7394' },
      closing: { mm: '936', litres: '5794' },
    });
    expect(parsed.dips.diesel).toEqual({
      opening: { mm: '1390', litres: '8722' },
      closing: { mm: '998', litres: '6219' },
    });
  });

  it('catches what does not add up in this very message', () => {
    const byCode = (code: string) => parsed.checks.filter((check) => check.code === code);
    // Diesel pump A1: 230170.28 - 229387.82 is 782.46, the message says 782.45.
    expect(byCode('PUMP_LITRES_DIFFER')).toHaveLength(1);
    expect(byCode('PUMP_LITRES_DIFFER')[0]!.message).toContain('Diesel pump A1');
    // Listed expenses add to 121, the message says 8369.
    expect(byCode('EXPENSE_TOTAL_DIFFERS')[0]!.message).toContain('121.00');
    // Petrol tank fell 1600 L for 1579.68 L sold: 20.32 L short. Diesel is 38.57 L over.
    const dips = byCode('DIP_DROP_DIFFERS').map((check) => check.message);
    expect(dips.find((m) => m.startsWith('Petrol'))).toContain('20.320 litres short');
    expect(dips.find((m) => m.startsWith('Diesel'))).toContain('38.580 litres over');
    // The 0.01 slip carries into the diesel total: the pumps add to 2541.58, the message says 2541.57.
    expect(byCode('TOTAL_LITRES_DIFFER')).toHaveLength(1);
    expect(byCode('TOTAL_LITRES_DIFFER')[0]!.message).toContain('Diesel');
    expect(byCode('MISSING')).toHaveLength(0);
  });

  it('says what is missing instead of guessing', () => {
    const empty = parseShiftMessage('Day Shift\nhello');
    expect(empty.date).toBeNull();
    expect(empty.checks.map((check) => check.message)).toEqual(
      expect.arrayContaining([
        'The date was not found in the message.',
        'The petrol pump readings was not found in the message.',
      ]),
    );
  });

  it('rejects an impossible date', () => {
    expect(parseShiftMessage('31/02/26').date).toBeNull();
  });
});
