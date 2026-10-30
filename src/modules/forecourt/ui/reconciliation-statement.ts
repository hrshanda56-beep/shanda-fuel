import { sumDecimals } from '../../cash/ui/cash-visuals';

/** What the existing read-only reconciliation endpoint returns, trimmed to what the statement shows. */
export type ReconciliationDetail = Readonly<{
  state: string;
  readings: ReadonlyArray<{ id: string; litresSold: string; salesValue: string }>;
  payments: ReadonlyArray<{ id: string; method: string; amount: string }>;
  expenses: ReadonlyArray<{ id: string; category: string; amount: string; paymentMethod: string }>;
  cash: { countedCash: string; netExpectedCash: string; cashVariance: string } | null;
  totals: {
    expectedSales: string;
    accountedSales: string;
    salesVariance: string;
    cashVariance: string | null;
  };
}>;

export type StatementShift = Readonly<{
  id: string;
  label: string;
  state: string;
  detail: ReconciliationDetail | null;
}>;

export type StatementLine = Readonly<{ description: string; amount: string }>;

export type StatementSection = Readonly<{
  id: string;
  label: string;
  state: string;
  /** Meter readings, so the sales line can say how many nozzles it covers. */
  nozzles: number;
  litres: string;
  expectedSales: string;
  paymentLines: readonly StatementLine[];
  expenseLines: readonly StatementLine[];
  accountedSales: string;
  salesVariance: string;
  expectedCash: string | null;
  countedCash: string | null;
  cashVariance: string | null;
}>;

export type Statement = Readonly<{
  sections: readonly StatementSection[];
  /** Shifts whose figures could not be loaded; they are listed, never counted as zero. */
  missing: readonly StatementShift[];
  totals: Readonly<{
    /** Null when no shift has figures: "nothing to add" is not the same as zero. */
    expectedSales: string | null;
    accountedSales: string | null;
    salesVariance: string | null;
    countedCash: string | null;
    cashVariance: string | null;
    /** True when every shift's figures loaded, so the totals cover the whole day. */
    complete: boolean;
    /** Shifts with figures but no counted cash; their cash is absent from the cash totals. */
    shiftsWithoutCash: number;
  }>;
}>;

function groupLines(
  rows: ReadonlyArray<{ key: string; amount: string }>,
  label: (key: string) => string,
): StatementLine[] {
  const keys = [...new Set(rows.map((row) => row.key))];
  return keys.map((key) => ({
    description: label(key),
    amount: sumDecimals(rows.filter((row) => row.key === key).map((row) => row.amount)),
  }));
}

/** Arranges the figures the server already computed. The only arithmetic is adding shifts together. */
export function buildStatement(
  shifts: readonly StatementShift[],
  label: (value: string) => string,
): Statement {
  const sections: StatementSection[] = [];
  const missing: StatementShift[] = [];
  for (const shift of shifts) {
    const detail = shift.detail;
    if (!detail) {
      missing.push(shift);
      continue;
    }
    sections.push({
      id: shift.id,
      label: shift.label,
      state: shift.state,
      nozzles: detail.readings.length,
      litres: sumDecimals(detail.readings.map((reading) => reading.litresSold)),
      expectedSales: detail.totals.expectedSales,
      paymentLines: groupLines(
        detail.payments.map((payment) => ({ key: payment.method, amount: payment.amount })),
        label,
      ),
      expenseLines: groupLines(
        detail.expenses.map((expense) => ({ key: expense.category, amount: expense.amount })),
        label,
      ),
      accountedSales: detail.totals.accountedSales,
      salesVariance: detail.totals.salesVariance,
      expectedCash: detail.cash?.netExpectedCash ?? null,
      countedCash: detail.cash?.countedCash ?? null,
      cashVariance: detail.totals.cashVariance ?? detail.cash?.cashVariance ?? null,
    });
  }
  const counted = sections.flatMap((section) =>
    section.countedCash === null ? [] : [section.countedCash],
  );
  const cashVariances = sections.flatMap((section) =>
    section.cashVariance === null ? [] : [section.cashVariance],
  );
  const add = (pick: (section: StatementSection) => string) =>
    sections.length > 0 ? sumDecimals(sections.map(pick)) : null;
  return {
    sections,
    missing,
    totals: {
      expectedSales: add((section) => section.expectedSales),
      accountedSales: add((section) => section.accountedSales),
      salesVariance: add((section) => section.salesVariance),
      countedCash: counted.length > 0 ? sumDecimals(counted) : null,
      cashVariance: cashVariances.length > 0 ? sumDecimals(cashVariances) : null,
      complete: missing.length === 0 && sections.length > 0,
      shiftsWithoutCash: sections.length - counted.length,
    },
  };
}

/** Wording for a figure that is absent, never a zero. */
export const NOT_RECORDED = 'Not recorded';
export const NOT_AVAILABLE = 'Not available';

function csvCell(value: string): string {
  // A leading = + - @ would be read as a formula by a spreadsheet; amounts keep their sign, so they are left alone.
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Full-precision CSV of the statement for opening in a spreadsheet. It is one plain table: every
 * row has the same columns, so any spreadsheet or viewer splits it correctly and it can be filtered.
 */
export function statementToCsv(input: {
  organisation: string;
  station: string;
  businessDate: string;
  currency: string;
  statement: Statement;
}): string {
  const { statement } = input;
  const { totals } = statement;
  const rows: string[][] = [
    [
      'Organisation',
      'Station',
      'Business date',
      'Shift',
      'Section',
      'Description',
      `Amount (${input.currency})`,
    ],
  ];
  const line = (shift: string, part: string, description: string, amount: string | null) => {
    rows.push([
      input.organisation,
      input.station,
      input.businessDate,
      shift,
      part,
      description,
      amount ?? NOT_RECORDED,
    ]);
  };
  for (const section of statement.sections) {
    const add = (part: string, description: string, amount: string | null) =>
      line(section.label, part, description, amount);
    add(
      'Sales',
      `Expected sales (${section.nozzles} nozzles, ${section.litres} L)`,
      section.expectedSales,
    );
    for (const entry of section.paymentLines) add('Accounted by', entry.description, entry.amount);
    for (const entry of section.expenseLines) add('Expenses', entry.description, entry.amount);
    add('Sales', 'Accounted sales', section.accountedSales);
    add('Sales', 'Sales variance', section.salesVariance);
    add('Cash', 'Expected cash', section.expectedCash);
    add('Cash', 'Counted cash', section.countedCash);
    add('Cash', 'Cash variance', section.cashVariance);
  }
  for (const shift of statement.missing)
    line(shift.label, 'Sales', 'Figures could not be loaded', NOT_AVAILABLE);
  line('Total', 'Sales', 'Expected sales', totals.expectedSales ?? NOT_AVAILABLE);
  line('Total', 'Sales', 'Accounted sales', totals.accountedSales ?? NOT_AVAILABLE);
  line('Total', 'Sales', 'Sales variance', totals.salesVariance ?? NOT_AVAILABLE);
  line('Total', 'Cash', 'Counted cash', totals.countedCash);
  line('Total', 'Cash', 'Cash variance', totals.cashVariance);
  if (statement.missing.length > 0)
    line(
      'Note',
      '',
      `Totals exclude ${statement.missing.length} shift(s) whose figures could not be loaded`,
      '',
    );
  if (totals.shiftsWithoutCash > 0)
    line(
      'Note',
      '',
      `Cash totals exclude ${totals.shiftsWithoutCash} shift(s) with no counted cash`,
      '',
    );
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
