/**
 * Monthly ZERA return: the supplied and sold litres the regulator asks for, worked out from the
 * month's confirmed deliveries and approved sales. Everything here is a pure function so the rules
 * can be tested without a database.
 *
 * Rules (recorded in issue #258):
 * - Diesel 50ppm box: D50 products only. Plain diesel is not counted there; it is listed in the notes.
 * - Petrol box: petrol and blended petrol (blends are petrol with ethanol).
 * - Gas and other products are listed in the notes and never added to litres.
 * - A product with no fuel type blocks the return until its type is set (never guessed).
 * - ZERA's own rule, printed on the form: "Volumes in full litres, rounded to the nearest litre"
 *   (203 401.56 L becomes 203 402). Amounts are summed exactly (no floating point) and rounded
 *   once, at the end. The form gives no rule for an exact half litre, so it goes up, as in ordinary
 *   rounding to the nearest whole number. Nothing is ever rounded before the final sum.
 * - `0` when nothing moved. `m` for sold litres when any day of the month has no approved report.
 */

export type ZeraProductKind = 'DIESEL' | 'D50' | 'PETROL' | 'BLEND' | 'GAS' | 'OTHER';

export type ZeraMovementRow = Readonly<{
  productId: string;
  productName: string;
  kind: ZeraProductKind | null;
  /** Ethanol share, only for blends (5, 10, 15 or 20). */
  blendPercent: number | null;
  unit: 'LITRES' | 'KILOGRAMS';
  /** Exact decimal text as stored, e.g. "1234.5600". */
  quantity: string;
}>;

export type ZeraBox = 'DIESEL_50' | 'PETROL';

export type ZeraBoxFigures = Readonly<{
  /** Whole litres as text, or `m` when the figure cannot be stated yet. */
  supplied: string;
  sold: string;
}>;

export type ZeraNote = Readonly<{ code: string; text: string }>;

export type ZeraReturn = Readonly<{
  diesel50: ZeraBoxFigures;
  petrol: ZeraBoxFigures;
  /** The ethanol percentage when exactly one is in use; null when it must be asked. */
  ethanolPercent: number | null;
  /** Blend percentages found in the month, when more than one is in use. */
  ethanolChoices: readonly number[];
  /** Products with no fuel type. The return cannot be finished until these are fixed. */
  blockers: readonly Readonly<{ productId: string; productName: string }>[];
  /** Business days in the month with no approved report. */
  missingDays: readonly string[];
  notes: readonly ZeraNote[];
}>;

const SCALE = 6;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

/** Parses a plain decimal string into an integer scaled by 10^6 without touching floats. */
export function parseDecimalScaled(value: string): bigint {
  const text = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`Not a plain decimal: ${value}`);
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace('-', '').split('.');
  // Never drop digits silently: a stored quantity with more precision than this would change a figure.
  if (/[1-9]/.test(fraction.slice(SCALE))) {
    throw new Error(`More decimal places than the return can hold exactly: ${value}`);
  }
  const padded = (fraction + '0'.repeat(SCALE)).slice(0, SCALE);
  const scaled = BigInt(whole) * SCALE_FACTOR + BigInt(padded);
  return negative ? -scaled : scaled;
}

/** ZERA: nearest whole litre (203401.56 -> 203402, 203401.44 -> 203401). An exact half goes up. */
export function roundHalfUpWhole(scaled: bigint): bigint {
  const half = SCALE_FACTOR / 2n;
  if (scaled >= 0n) return (scaled + half) / SCALE_FACTOR;
  return -((-scaled + half) / SCALE_FACTOR);
}

export function boxForKind(kind: ZeraProductKind | null): ZeraBox | 'NOTES_ONLY' | 'BLOCKED' {
  if (kind === null) return 'BLOCKED';
  if (kind === 'D50') return 'DIESEL_50';
  if (kind === 'PETROL' || kind === 'BLEND') return 'PETROL';
  return 'NOTES_ONLY';
}

type Totals = Record<ZeraBox, bigint>;

function sumByBox(rows: readonly ZeraMovementRow[]): Totals {
  const totals: Totals = { DIESEL_50: 0n, PETROL: 0n };
  for (const row of rows) {
    const box = boxForKind(row.kind);
    // Kilograms are never added to litres.
    if ((box === 'DIESEL_50' || box === 'PETROL') && row.unit === 'LITRES') {
      totals[box] += parseDecimalScaled(row.quantity);
    }
  }
  return totals;
}

function figure(total: bigint): string {
  return String(roundHalfUpWhole(total));
}

function noteOnlyLines(label: string, rows: readonly ZeraMovementRow[], code: string): ZeraNote[] {
  const byProduct = new Map<string, { name: string; unit: string; total: bigint }>();
  for (const row of rows) {
    if (boxForKind(row.kind) !== 'NOTES_ONLY') continue;
    const entry = byProduct.get(row.productId) ?? {
      name: row.productName,
      unit: row.unit,
      total: 0n,
    };
    entry.total += parseDecimalScaled(row.quantity);
    byProduct.set(row.productId, entry);
  }
  return [...byProduct.values()]
    .filter((entry) => entry.total !== 0n)
    .map((entry) => ({
      code,
      text: `${entry.name} ${label} ${figure(entry.total)} ${
        entry.unit === 'KILOGRAMS' ? 'kg' : 'litres'
      } (not part of the ZERA boxes).`,
    }));
}

/** Days of a month (YYYY-MM) that are already over, as YYYY-MM-DD, stopping before `today`. */
export function monthDaysUpTo(month: string, today: string): string[] {
  const [year, mon] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year!, mon!, 0)).getUTCDate();
  const days: string[] = [];
  for (let day = 1; day <= last; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    if (date < today) days.push(date);
  }
  return days;
}

/**
 * Days that should have an approved report and do not. Days before the station's first business day
 * are not expected, and today (and later) is never missing.
 */
export function findMissingMonthDays(input: {
  month: string;
  today: string;
  firstBusinessDate: string | null;
  approvedDates: readonly string[];
}): string[] {
  if (input.firstBusinessDate === null) return monthDaysUpTo(input.month, input.today);
  const approved = new Set(input.approvedDates);
  return monthDaysUpTo(input.month, input.today).filter(
    (date) => date >= input.firstBusinessDate! && !approved.has(date),
  );
}

export function buildZeraReturn(input: {
  supplied: readonly ZeraMovementRow[];
  sold: readonly ZeraMovementRow[];
  missingDays: readonly string[];
  /** Ethanol percentage the owner picked when more than one is in use, or when none is known. */
  chosenEthanolPercent?: number | null;
}): ZeraReturn {
  const suppliedTotals = sumByBox(input.supplied);
  const soldTotals = sumByBox(input.sold);
  const soldIsKnown = input.missingDays.length === 0;

  const blockers = new Map<string, string>();
  for (const row of [...input.supplied, ...input.sold]) {
    if (boxForKind(row.kind) === 'BLOCKED') blockers.set(row.productId, row.productName);
  }

  const blendPercents = new Set<number>();
  for (const row of [...input.supplied, ...input.sold]) {
    if (row.kind === 'BLEND' && row.blendPercent !== null) blendPercents.add(row.blendPercent);
  }
  const ethanolChoices = [...blendPercents].sort((a, b) => a - b);
  const ethanolPercent =
    input.chosenEthanolPercent ?? (ethanolChoices.length === 1 ? ethanolChoices[0]! : null);

  const notes: ZeraNote[] = [
    ...noteOnlyLines('supplied', input.supplied, 'NOTES_SUPPLIED'),
    ...noteOnlyLines('sold', input.sold, 'NOTES_SOLD'),
  ];
  if (!soldIsKnown) {
    notes.push({
      code: 'MISSING_DAYS',
      text: `Sold litres are marked m because ${input.missingDays.length} day(s) have no approved report: ${input.missingDays.join(', ')}.`,
    });
  }

  return {
    diesel50: {
      supplied: figure(suppliedTotals.DIESEL_50),
      sold: soldIsKnown ? figure(soldTotals.DIESEL_50) : 'm',
    },
    petrol: {
      supplied: figure(suppliedTotals.PETROL),
      sold: soldIsKnown ? figure(soldTotals.PETROL) : 'm',
    },
    ethanolPercent,
    ethanolChoices,
    blockers: [...blockers].map(([productId, productName]) => ({ productId, productName })),
    missingDays: input.missingDays,
    notes,
  };
}
