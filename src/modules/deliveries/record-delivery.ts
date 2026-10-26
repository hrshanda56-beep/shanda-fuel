import Decimal from 'decimal.js';

export type CompartmentRow = {
  number: number;
  noteLitres: string;
  receivedLitres: string;
  /** Seal numbers typed as text, separated by commas. */
  seals: string;
};

const LITRES = /^\d+(?:\.\d{1,3})?$/;

function parse(value: string): Decimal | null {
  const text = value.trim();
  return LITRES.test(text) ? new Decimal(text) : null;
}

function plain(value: Decimal): string {
  const text = value.toDecimalPlaces(3).toFixed();
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** What the driver left against what the note said, in plain words. Null until both are numbers. */
export function shortageOrExcess(
  noteLitres: string,
  receivedLitres: string,
): { kind: 'SHORT' | 'OVER' | 'EXACT'; litres: string; text: string } | null {
  const note = parse(noteLitres);
  const received = parse(receivedLitres);
  if (!note || !received) return null;
  const difference = received.minus(note);
  if (difference.isZero()) {
    return { kind: 'EXACT', litres: '0', text: 'The litres received match the delivery note.' };
  }
  const litres = plain(difference.abs());
  return difference.isNegative()
    ? { kind: 'SHORT', litres, text: `Shortage of ${litres} litres against the delivery note.` }
    : { kind: 'OVER', litres, text: `Excess of ${litres} litres against the delivery note.` };
}

/**
 * The truck compartments must add up to the delivery. Returns what is wrong, or null when there
 * are no compartments or they agree with the note and the litres received.
 */
export function compartmentSumProblem(
  rows: readonly CompartmentRow[],
  noteLitres: string,
  receivedLitres: string,
): string | null {
  const filled = rows.filter((row) => row.noteLitres.trim() || row.receivedLitres.trim());
  if (filled.length === 0) return null;
  const note = parse(noteLitres);
  const received = parse(receivedLitres);
  if (!note || !received) return null;
  let noteTotal = new Decimal(0);
  let receivedTotal = new Decimal(0);
  for (const row of filled) {
    const rowNote = parse(row.noteLitres);
    const rowReceived = parse(row.receivedLitres);
    if (!rowNote || !rowReceived) {
      return `Compartment ${row.number} needs litres on the note and litres received, as numbers.`;
    }
    noteTotal = noteTotal.plus(rowNote);
    receivedTotal = receivedTotal.plus(rowReceived);
  }
  if (!noteTotal.eq(note)) {
    return `The compartments add up to ${plain(noteTotal)} litres on the note, but the delivery note says ${plain(note)}.`;
  }
  if (!receivedTotal.eq(received)) {
    return `The compartments add up to ${plain(receivedTotal)} litres received, but you said ${plain(received)} were received.`;
  }
  return null;
}
