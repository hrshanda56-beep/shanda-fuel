import Decimal from 'decimal.js';

/**
 * The same arithmetic the server uses to total a reconciliation, so the figures on screen update as
 * values are typed. These are for display only: the server recomputes everything when the draft is
 * saved and again on submit, and its answer is the one that counts.
 */
export type MathReading = Readonly<{
  openingReading: string;
  closingReading: string;
  unitPrice?: string | null;
}>;
export type MathAmount = Readonly<{ method?: string; paymentMethod?: string; amount: string }>;

function parse(value: string | null | undefined): Decimal | null {
  const text = (value ?? '').trim();
  return /^-?\d+(\.\d+)?$/.test(text) ? new Decimal(text) : null;
}

/** Litres between two meter readings to three decimals; null until both are valid and in order. */
export function litresBetween(opening: string, closing: string): Decimal | null {
  const from = parse(opening);
  const to = parse(closing);
  if (!from || !to || to.lt(from)) return null;
  return to.minus(from).toDecimalPlaces(3, Decimal.ROUND_HALF_EVEN);
}

export type ReconciliationTotals = Readonly<{
  expectedSales: Decimal;
  accountedSales: Decimal;
  /** Accounted for minus expected: negative means short. */
  salesDifference: Decimal;
  cash: Readonly<{
    expected: Decimal;
    paidOut: Decimal;
    net: Decimal;
    counted: Decimal | null;
    /** Counted minus net expected; null until the cash is counted. */
    difference: Decimal | null;
  }>;
}>;

export function computeTotals(input: {
  readings: readonly MathReading[];
  payments: readonly MathAmount[];
  expenses: readonly MathAmount[];
  countedCash: string;
}): ReconciliationTotals {
  const sum = (values: readonly (Decimal | null)[]) =>
    values.reduce<Decimal>((total, value) => (value ? total.plus(value) : total), new Decimal(0));

  const expectedSales = sum(
    input.readings.map((reading) => {
      const litres = litresBetween(reading.openingReading, reading.closingReading);
      const price = parse(reading.unitPrice);
      return litres && price ? litres.times(price).toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN) : null;
    }),
  );
  const accountedSales = sum(input.payments.map((payment) => parse(payment.amount)));
  const cashExpected = sum(
    input.payments.filter((payment) => payment.method === 'CASH').map((payment) => parse(payment.amount)),
  );
  const paidOut = sum(
    input.expenses
      .filter((expense) => expense.paymentMethod === 'CASH')
      .map((expense) => parse(expense.amount)),
  );
  const net = cashExpected.minus(paidOut);
  const counted = parse(input.countedCash);
  return {
    expectedSales,
    accountedSales,
    salesDifference: accountedSales.minus(expectedSales),
    cash: {
      expected: cashExpected,
      paidOut,
      net,
      counted,
      difference: counted ? counted.minus(net) : null,
    },
  };
}

export function isZeroDecimal(value: Decimal | null | undefined): boolean {
  return !value || value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).isZero();
}
