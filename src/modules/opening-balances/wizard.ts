import { tankLabel } from '../inventory/ui/tank-overview-model';
import { OPENING_BALANCE_CSV_HEADERS } from './domain';

/**
 * The rules of the opening-balances wizard (#250): the figures a station starts with, asked one
 * question at a time instead of in a spreadsheet. The answers are turned into the same CSV the
 * spreadsheet import reads, so the preview, approve and lock rules are exactly the same. Pure, so
 * the screens only draw what these decide.
 */

/** What a person can pick from for one station; read from the server. */
export type OpeningOptions = Readonly<{
  station: Readonly<{
    id: string;
    code: string;
    name: string;
    /** How the company is named in the import. */
    companyReference: string;
    companyName: string;
  }>;
  tanks: readonly Readonly<{
    code: string;
    fuel: string;
    capacityLitres: string;
    hasOpening: boolean;
  }>[];
  cashLocations: readonly Readonly<{ code: string; name: string; hasOpening: boolean }>[];
  bankAccounts: readonly Readonly<{ name: string; bankName: string; hasOpening: boolean }>[];
  customers: readonly Readonly<{ accountId: string; name: string; hasOpening: boolean }>[];
  suppliers: readonly Readonly<{ code: string; name: string }>[];
}>;

export type TankEntry = { litres: string; value: string };
export type CustomerEntry = { accountId: string; name: string; amount: string; due: string };
export type SupplierEntry = {
  code: string;
  name: string;
  reference: string;
  amount: string;
  due: string;
};

export type OpeningAnswers = {
  /** The day the figures are for, `YYYY-MM-DD`. */
  asOf: string;
  /** By tank code. A tank with no entry is left out. */
  tanks: Record<string, TankEntry>;
  /** By cash location code. */
  cash: Record<string, string>;
  /** By bank account name. */
  bank: Record<string, string>;
  customers: CustomerEntry[];
  suppliers: SupplierEntry[];
};

export const BLANK_OPENING: OpeningAnswers = {
  asOf: '',
  tanks: {},
  cash: {},
  bank: {},
  customers: [],
  suppliers: [],
};

export const MAX_REFERENCE = 80;
const CUSTOMER_REFERENCE = 'Opening balance';

type Errors = Record<string, string>;

/* --------------------------------- numbers --------------------------------- */

/** A decimal with at most `places` digits after the point, as the exact text the server expects. */
function decimal(text: string, places: number): string | null {
  const value = text.trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole = '', fraction = ''] = value.split('.');
  if (fraction.length > places) return null;
  return fraction ? `${whole}.${fraction}` : whole;
}
const isZero = (value: string) => /^0*(?:\.0*)?$/.test(value);
const exceeds = (a: string, b: string) => Number(a) > Number(b);

export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/* --------------------------------- checks --------------------------------- */

export function checkAsOf(asOf: string): Errors {
  return isCalendarDay(asOf) ? {} : { asOf: 'Choose the day these figures are for.' };
}

export function checkLitres(entry: TankEntry, capacityLitres: string, word = 'litres'): Errors {
  const errors: Errors = {};
  const litres = decimal(entry.litres, 3);
  if (litres === null || isZero(litres)) {
    errors.litres = `Enter how many ${word} are in the tank, or choose None.`;
  } else if (exceeds(litres, capacityLitres)) {
    errors.litres = `The tank only holds ${Number(capacityLitres).toLocaleString('en-US')} ${word}.`;
  }
  if (entry.value.trim()) {
    const value = decimal(entry.value, 4);
    if (value === null || isZero(value)) {
      errors.value = 'Enter the value in US$, or leave this empty.';
    }
  }
  return errors;
}

/** An amount of money that must be more than zero (cash, what a customer owes, an invoice). */
export function checkAmount(text: string, what: string): Errors {
  const amount = decimal(text, 4);
  return amount === null || isZero(amount) ? { amount: `Enter ${what}, or choose None.` } : {};
}

/** A bank balance may be zero. */
export function checkBalance(text: string): Errors {
  return decimal(text, 4) === null ? { amount: 'Enter the balance, for example 1500 or 0.' } : {};
}

export function checkDue(due: string, asOf: string): Errors {
  if (!due.trim()) return {};
  if (!isCalendarDay(due)) return { due: 'Choose a real day, or leave this empty.' };
  if (isCalendarDay(asOf) && due < asOf) {
    return { due: 'The due day cannot be before the day these figures are for.' };
  }
  return {};
}

export function checkReference(reference: string, taken: readonly string[]): Errors {
  const value = reference.trim();
  if (!value) return { reference: 'Enter the invoice number or reference.' };
  if (value.length > MAX_REFERENCE) return { reference: `Use at most ${MAX_REFERENCE} letters.` };
  if (taken.some((other) => other.trim().toLowerCase() === value.toLowerCase())) {
    return { reference: 'You have already added an invoice with this reference.' };
  }
  return {};
}

export const checkPick = (id: string | null, what: string): Errors =>
  id ? {} : { pick: `Choose ${what}.` };

/* --------------------------------- what to ask --------------------------------- */

export type Section = 'tank' | 'cash' | 'bank';

/** The items still without an opening figure, for each of the three "one per screen" sections. */
export function todo(options: OpeningOptions) {
  return {
    tank: options.tanks.filter((t) => !t.hasOpening),
    cash: options.cashLocations.filter((l) => !l.hasOpening),
    bank: options.bankAccounts.filter((b) => !b.hasOpening),
    /** Customers who can still be given an opening debt. */
    customers: options.customers.filter((c) => !c.hasOpening),
  };
}

/** True when nothing was entered at all. */
export function isEmpty(answers: OpeningAnswers): boolean {
  return (
    Object.keys(answers.tanks).length === 0 &&
    Object.keys(answers.cash).length === 0 &&
    Object.keys(answers.bank).length === 0 &&
    answers.customers.length === 0 &&
    answers.suppliers.length === 0
  );
}

/** How many figures were entered, for the check screen's heading. */
export function countEntered(answers: OpeningAnswers): number {
  return (
    Object.keys(answers.tanks).length +
    Object.keys(answers.cash).length +
    Object.keys(answers.bank).length +
    answers.customers.length +
    answers.suppliers.length
  );
}

/* --------------------------------- the import file --------------------------------- */

const csvCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

type Row = Partial<Record<(typeof OPENING_BALANCE_CSV_HEADERS)[number], string>>;

/** One entered figure as the plain sentence the person reads on the check screen. */
export type OpeningLine = Readonly<{
  /** Which kind of figure it is: "Fuel in tank", "Cash", "Bank", "Customer owes", "Unpaid invoice". */
  kind: string;
  label: string;
  amount: string;
}>;

const money = (text: string) =>
  `US$${Number(text.replace(/,/g, '')).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/**
 * The same CSV the spreadsheet import reads, plus one plain label per data row (in order), so a
 * problem the server reports for "line 3" can be named for the person ("Tank T1").
 */
export function buildOpeningCsv(
  options: OpeningOptions,
  answers: OpeningAnswers,
): { csv: string; lines: readonly OpeningLine[] } {
  const rows: Row[] = [];
  const lines: OpeningLine[] = [];
  const base = { effective_date: answers.asOf, currency: 'USD' } as const;

  for (const tank of options.tanks) {
    const entry = answers.tanks[tank.code];
    if (!entry) continue;
    const litres = decimal(entry.litres, 3) ?? entry.litres;
    rows.push({
      ...base,
      line_key: `tank-${tank.code}`,
      line_type: 'TANK_STOCK',
      station_code: options.station.code,
      tank_code: tank.code,
      quantity_litres: litres,
      inventory_value: entry.value.trim() ? (decimal(entry.value, 4) ?? entry.value) : '',
    });
    lines.push({
      kind: 'Fuel in tank',
      label: `${tankLabel(tank.code)} (${tank.fuel})`,
      amount: `${Number(litres).toLocaleString('en-US', { maximumFractionDigits: 3 })} litres`,
    });
  }
  for (const place of options.cashLocations) {
    const amount = answers.cash[place.code];
    if (amount === undefined) continue;
    rows.push({
      ...base,
      line_key: `cash-${place.code}`,
      line_type: 'CASH_BALANCE',
      station_code: options.station.code,
      cash_location_code: place.code,
      amount: decimal(amount, 4) ?? amount,
    });
    lines.push({ kind: 'Cash', label: place.name, amount: money(amount) });
  }
  for (const account of options.bankAccounts) {
    const amount = answers.bank[account.name];
    if (amount === undefined) continue;
    rows.push({
      ...base,
      line_key: `bank-${account.name}`,
      line_type: 'BANK_BALANCE',
      legal_entity_reference: options.station.companyReference,
      bank_account_name: account.name,
      amount: decimal(amount, 4) ?? amount,
    });
    lines.push({
      kind: 'Bank',
      label: `${account.name} (${account.bankName})`,
      amount: money(amount),
    });
  }
  answers.customers.forEach((customer, index) => {
    rows.push({
      ...base,
      line_key: `customer-${index + 1}`,
      line_type: 'CUSTOMER_CHARGE',
      account_reference: customer.accountId,
      reference: CUSTOMER_REFERENCE,
      due_date: customer.due.trim(),
      amount: decimal(customer.amount, 4) ?? customer.amount,
    });
    lines.push({ kind: 'Customer owes', label: customer.name, amount: money(customer.amount) });
  });
  answers.suppliers.forEach((supplier, index) => {
    rows.push({
      ...base,
      line_key: `supplier-${index + 1}`,
      line_type: 'SUPPLIER_INVOICE',
      legal_entity_reference: options.station.companyReference,
      supplier_code: supplier.code,
      reference: supplier.reference.trim(),
      due_date: supplier.due.trim(),
      amount: decimal(supplier.amount, 4) ?? supplier.amount,
    });
    lines.push({
      kind: 'Unpaid invoice',
      label: `${supplier.name}, invoice ${supplier.reference.trim()}`,
      amount: money(supplier.amount),
    });
  });

  const header = OPENING_BALANCE_CSV_HEADERS.join(',');
  const body = rows.map((row) =>
    OPENING_BALANCE_CSV_HEADERS.map((name) => csvCell(row[name] ?? '')).join(','),
  );
  return { csv: [header, ...body].join('\n') + '\n', lines };
}

/**
 * The tanks that hold fuel in the answers but have no value. They are accepted, yet a station with
 * such a tank cannot go live until the cost is entered, so the check screen says so up front.
 */
export function tanksWithoutValue(options: OpeningOptions, answers: OpeningAnswers): string[] {
  return options.tanks
    .filter((tank) => {
      const entry = answers.tanks[tank.code];
      return entry !== undefined && !isZero(entry.litres.trim()) && entry.value.trim() === '';
    })
    .map((tank) => tankLabel(tank.code));
}

/** A problem the server found in the file. */
export type OpeningIssue = Readonly<{
  lineNumber: number | null;
  field: string | null;
  message: string;
}>;

/**
 * The server's problems as sentences a person can act on. A problem on data row N is named for the
 * figure it belongs to ("Tank T1: …"); the file's first line is the header.
 */
export function describeIssues(
  lines: readonly OpeningLine[],
  issues: readonly OpeningIssue[],
): string[] {
  return issues.map((issue) => {
    const line = issue.lineNumber !== null ? lines[issue.lineNumber - 2] : undefined;
    return line ? `${line.label}: ${issue.message}` : issue.message;
  });
}

/* --------------------------------- saving --------------------------------- */

export type BatchSteps = 'draft' | 'approved' | 'locked';

/** What the person is told after each stage. */
export const STAGE_TEXT: Record<BatchSteps, { title: string; body: string }> = {
  draft: {
    title: 'Saved as a draft',
    body: 'Nothing has changed in your books yet. The next step is to approve the figures.',
  },
  approved: {
    title: 'Approved',
    body: 'One more step: lock and post them. Locked figures cannot be edited.',
  },
  locked: {
    title: 'The opening balances are locked and posted',
    body: 'The station now starts from these figures.',
  },
};
