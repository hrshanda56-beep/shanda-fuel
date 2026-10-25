/**
 * Reads the shift summary a supervisor sends on WhatsApp (pump readings, expenses, cash, tank dips,
 * attendants) and checks its arithmetic. Pure and read-only: it never saves anything. Every figure
 * stays an exact decimal string, and a figure that cannot be read is reported, never guessed.
 *
 * The message is free text, so reading is tolerant of the usual slips (a missing space, "Superviser",
 * stars and underscores from WhatsApp formatting) but strict about numbers.
 */
import { ExactDecimal } from '../../platform/domain/primitives';

export type ShiftMessagePump = Readonly<{
  label: string;
  opening: string | null;
  closing: string | null;
  /** The litres the supervisor wrote down. */
  litres: string | null;
}>;

export type ShiftMessageFuel = Readonly<{
  price: string | null;
  pumps: readonly ShiftMessagePump[];
  totalLitres: string | null;
}>;

export type ShiftMessageDip = Readonly<{ mm: string; litres: string }>;

export type ShiftMessageDips = Readonly<{
  opening: ShiftMessageDip | null;
  closing: ShiftMessageDip | null;
}>;

export type ShiftMessageExpense = Readonly<{ description: string; amount: string }>;

export type ShiftMessageCheck = Readonly<{
  code:
    | 'PUMP_LITRES_DIFFER'
    | 'TOTAL_LITRES_DIFFER'
    | 'EXPENSE_TOTAL_DIFFERS'
    | 'DIP_DROP_DIFFERS'
    | 'MISSING';
  message: string;
}>;

export type ShiftMessage = Readonly<{
  /** ISO date (yyyy-mm-dd) read from a day/month/year line, or null. */
  date: string | null;
  shift: string | null;
  petrol: ShiftMessageFuel;
  diesel: ShiftMessageFuel;
  expenses: readonly ShiftMessageExpense[];
  statedExpenseTotal: string | null;
  /** Cash taken off the till during the shift ("Drop"). */
  cashDrop: string | null;
  availableCash: string | null;
  dips: Readonly<{ petrol: ShiftMessageDips; diesel: ShiftMessageDips }>;
  attendants: string | null;
  supervisor: string | null;
  checks: readonly ShiftMessageCheck[];
}>;

type Fuel = 'petrol' | 'diesel';
type MutablePump = {
  label: string;
  opening: string | null;
  closing: string | null;
  litres: string | null;
};
type MutableFuel = { price: string | null; pumps: MutablePump[]; totalLitres: string | null };
type MutableDips = { opening: ShiftMessageDip | null; closing: ShiftMessageDip | null };

const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)`;

/** "1,234.5" becomes "1234.5". Returns null when it is not a plain number. */
function cleanNumber(text: string | undefined): string | null {
  if (!text) return null;
  const value = text.replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(value) ? value : null;
}

function isoDate(day: string, month: string, year: string): string | null {
  const fullYear = year.length === 2 ? `20${year}` : year;
  const date = new Date(Date.UTC(Number(fullYear), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(fullYear) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function exact(value: string): ExactDecimal {
  return new ExactDecimal(value);
}

function formatThree(value: ExactDecimal): string {
  return value.value.toFixed(3);
}

function formatTwo(value: ExactDecimal): string {
  return value.value.toFixed(2);
}

export function parseShiftMessage(text: string): ShiftMessage {
  const lines = text
    .replace(/[*_~`]/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0 && !/^[-=\s]+$/.test(line));

  let date: string | null = null;
  let shift: string | null = null;
  const fuels: Record<Fuel, MutableFuel> = {
    petrol: { price: null, pumps: [], totalLitres: null },
    diesel: { price: null, pumps: [], totalLitres: null },
  };
  const dips: Record<Fuel, MutableDips> = {
    petrol: { opening: null, closing: null },
    diesel: { opening: null, closing: null },
  };
  const expenses: ShiftMessageExpense[] = [];
  let statedExpenseTotal: string | null = null;
  let cashDrop: string | null = null;
  let availableCash: string | null = null;
  let attendants: string | null = null;
  let supervisor: string | null = null;

  type Mode = 'header' | 'fuel' | 'expenses' | 'cash' | 'dips' | 'summary';
  let mode: Mode = 'header';
  let fuel: Fuel | null = null;
  let pump: MutablePump | null = null;
  let dipFuel: Fuel | null = null;
  let expectTotalFor: Fuel | null = null;

  for (const line of lines) {
    const dateMatch = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/.exec(line);
    if (dateMatch) {
      date = isoDate(dateMatch[1]!, dateMatch[2]!, dateMatch[3]!);
      continue;
    }
    const shiftMatch = /^(day|night|morning|evening|afternoon|early|late)\s+shift$/i.exec(line);
    if (shiftMatch) {
      shift = `${shiftMatch[1]![0]!.toUpperCase()}${shiftMatch[1]!.slice(1).toLowerCase()}`;
      continue;
    }
    const fuelHeading = /^(petrol|diesel)\s+(sales|pumps?)\b/i.exec(line);
    if (fuelHeading) {
      mode = 'fuel';
      fuel = fuelHeading[1]!.toLowerCase() as Fuel;
      pump = null;
      expectTotalFor = null;
      continue;
    }
    if (/^total litres? sold$/i.test(line)) {
      if (mode === 'fuel' && fuel) expectTotalFor = fuel;
      else mode = 'summary';
      continue;
    }
    if (/^expenses?\b/i.test(line)) {
      mode = 'expenses';
      continue;
    }
    if (/^available cash\b/i.test(line)) {
      mode = 'cash';
      const same = new RegExp(NUMBER).exec(line.replace(/^available cash/i, ''));
      if (same) availableCash = cleanNumber(same[1]);
      continue;
    }
    if (/^excess/i.test(line)) {
      mode = 'cash';
      continue;
    }
    if (/^site dips?\b/i.test(line)) {
      mode = 'dips';
      dipFuel = null;
      continue;
    }
    const attendantMatch = /^attendants?\s*[:=-]?\s*(.*)$/i.exec(line);
    if (attendantMatch) {
      attendants = attendantMatch[1]!.trim() || null;
      continue;
    }
    const supervisorMatch = /^supervis(?:or|er)\s*[:=-]?\s*(.*)$/i.exec(line);
    if (supervisorMatch) {
      supervisor = supervisorMatch[1]!.trim() || null;
      continue;
    }

    if (mode === 'fuel' && fuel) {
      if (expectTotalFor) {
        const total = cleanNumber(new RegExp(`^${NUMBER}$`).exec(line)?.[1]);
        if (total) {
          fuels[expectTotalFor].totalLitres = total;
          expectTotalFor = null;
          continue;
        }
      }
      const price = new RegExp(String.raw`prices?\s*[=:]?\s*\$?\s*${NUMBER}`, 'i').exec(line);
      if (price) {
        fuels[fuel].price = cleanNumber(price[1]);
        continue;
      }
      const label = /^([A-Za-z]\s?\d+)$/.exec(line);
      if (label) {
        pump = {
          label: label[1]!.replace(/\s/g, '').toUpperCase(),
          opening: null,
          closing: null,
          litres: null,
        };
        fuels[fuel].pumps.push(pump);
        continue;
      }
      if (pump) {
        const closing = new RegExp(String.raw`^clos(?:ing|e)\s*[:=]?\s*${NUMBER}`, 'i').exec(line);
        if (closing) {
          pump.closing = cleanNumber(closing[1]);
          continue;
        }
        const opening = new RegExp(String.raw`^open(?:ing)?\s*[:=]?\s*${NUMBER}`, 'i').exec(line);
        if (opening) {
          pump.opening = cleanNumber(opening[1]);
          continue;
        }
        const litres = new RegExp(String.raw`^l(?:tr|itre)s?\.?\s*[:=]?\s*${NUMBER}`, 'i').exec(
          line,
        );
        if (litres) {
          pump.litres = cleanNumber(litres[1]);
          continue;
        }
      }
      continue;
    }

    if (mode === 'expenses') {
      const item = new RegExp(String.raw`^(.*?[A-Za-z])\s*[-:=]?\s*\$?\s*${NUMBER}$`).exec(line);
      if (!item) continue;
      const description = item[1]!.trim();
      const amount = cleanNumber(item[2]);
      if (!amount) continue;
      if (/^total$/i.test(description)) statedExpenseTotal = amount;
      else if (/^drop$/i.test(description)) cashDrop = amount;
      else expenses.push({ description, amount });
      continue;
    }

    if (mode === 'cash') {
      if (availableCash === null) {
        const amount = new RegExp(String.raw`\$?\s*${NUMBER}`).exec(line);
        if (amount) availableCash = cleanNumber(amount[1]);
      }
      continue;
    }

    if (mode === 'dips') {
      const product = /^(petrol|diesel)$/i.exec(line);
      if (product) {
        dipFuel = product[1]!.toLowerCase() as Fuel;
        continue;
      }
      if (dipFuel) {
        const dip = new RegExp(
          String.raw`^(open(?:ing)?|clos(?:ing|e))\s*[:=]?\s*${NUMBER}\s*mm\s*[-:=]?\s*${NUMBER}\s*l`,
          'i',
        ).exec(line);
        if (dip) {
          const mm = cleanNumber(dip[2]);
          const litres = cleanNumber(dip[3]);
          if (mm && litres) {
            const key = dip[1]!.toLowerCase().startsWith('open') ? 'opening' : 'closing';
            dips[dipFuel][key] = { mm, litres };
          }
        }
      }
      continue;
    }
    // 'summary' lines ("Petrol-1579.68 Ltrs") repeat the totals above and are not needed.
  }

  const checks = checkShiftMessage({
    date,
    shift,
    fuels,
    dips,
    expenses,
    statedExpenseTotal,
    availableCash,
  });

  return {
    date,
    shift,
    petrol: fuels.petrol,
    diesel: fuels.diesel,
    expenses,
    statedExpenseTotal,
    cashDrop,
    availableCash,
    dips,
    attendants,
    supervisor,
    checks,
  };
}

function checkShiftMessage(input: {
  date: string | null;
  shift: string | null;
  fuels: Record<Fuel, MutableFuel>;
  dips: Record<Fuel, MutableDips>;
  expenses: readonly ShiftMessageExpense[];
  statedExpenseTotal: string | null;
  availableCash: string | null;
}): ShiftMessageCheck[] {
  const checks: ShiftMessageCheck[] = [];
  const missing = (what: string) =>
    checks.push({ code: 'MISSING', message: `${what} was not found in the message.` });
  if (!input.date) missing('The date');
  if (!input.shift) missing('The shift');
  if (input.availableCash === null) missing('The available cash');

  const names: Record<Fuel, string> = { petrol: 'Petrol', diesel: 'Diesel' };
  const readLitres: Partial<Record<Fuel, ExactDecimal>> = {};
  for (const fuel of ['petrol', 'diesel'] as const) {
    const data = input.fuels[fuel];
    if (data.pumps.length === 0) {
      missing(`The ${names[fuel].toLowerCase()} pump readings`);
      continue;
    }
    let pumpTotal = exact('0');
    let complete = true;
    for (const pump of data.pumps) {
      if (pump.opening === null || pump.closing === null) {
        complete = false;
        missing(
          `The opening or closing reading for ${names[fuel].toLowerCase()} pump ${pump.label}`,
        );
        continue;
      }
      const worked = exact(pump.closing).subtract(exact(pump.opening));
      pumpTotal = pumpTotal.add(worked);
      if (pump.litres !== null && !worked.equals(exact(pump.litres))) {
        checks.push({
          code: 'PUMP_LITRES_DIFFER',
          message: `${names[fuel]} pump ${pump.label}: closing minus opening is ${formatTwo(worked)} litres, but the message says ${pump.litres}.`,
        });
      }
    }
    if (complete) {
      readLitres[fuel] = pumpTotal;
      if (data.totalLitres !== null && !pumpTotal.equals(exact(data.totalLitres))) {
        checks.push({
          code: 'TOTAL_LITRES_DIFFER',
          message: `${names[fuel]}: the pumps add up to ${formatTwo(pumpTotal)} litres, but the message says ${data.totalLitres}.`,
        });
      }
    }
  }

  if (input.expenses.length > 0 && input.statedExpenseTotal !== null) {
    const listed = input.expenses.reduce((sum, item) => sum.add(exact(item.amount)), exact('0'));
    if (!listed.equals(exact(input.statedExpenseTotal))) {
      checks.push({
        code: 'EXPENSE_TOTAL_DIFFERS',
        message: `The listed expenses add up to ${formatTwo(listed)}, but the message gives a total of ${input.statedExpenseTotal}.`,
      });
    }
  }

  // Assumes nothing was delivered during the shift: a delivery is not part of this message.
  for (const fuel of ['petrol', 'diesel'] as const) {
    const { opening, closing } = input.dips[fuel];
    const sold =
      readLitres[fuel] ??
      (input.fuels[fuel].totalLitres ? exact(input.fuels[fuel].totalLitres) : null);
    if (!opening || !closing || !sold) continue;
    const expectedClosing = exact(opening.litres).subtract(sold);
    const difference = exact(closing.litres).subtract(expectedClosing);
    if (!difference.value.isZero()) {
      const direction = difference.value.isNegative() ? 'short' : 'over';
      checks.push({
        code: 'DIP_DROP_DIFFERS',
        message: `${names[fuel]}: the tank went from ${opening.litres} to ${closing.litres} litres and ${formatTwo(sold)} litres were sold, so the tank is ${formatThree(exact(difference.value.abs().toFixed()))} litres ${direction} (if nothing was delivered).`,
      });
    }
  }
  return checks;
}
