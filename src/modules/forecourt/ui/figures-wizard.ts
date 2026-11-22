/**
 * Rules for entering a shift's figures one question per screen (#253): which screens there are, in
 * what order, where to resume, and how each answer is checked. No React here, so it can be tested
 * directly. The screens themselves are in `figures-screens.tsx`.
 */

export const FIGURE_STEPS = [
  'Team',
  'Pumps',
  'Payments',
  'Expenses',
  'Cash',
  'Tank dips',
  'Submit',
] as const;
export type FigureStep = (typeof FIGURE_STEPS)[number];

/** The differences a supervisor may have to explain before submitting. */
export type Difference = 'SALES' | 'CASH' | 'STOCK';

export type FigureScreen = { id: string; step: FigureStep };

export type ScreenInput = {
  /** Staff from other stations are listed on a screen of their own. */
  hasVisiting: boolean;
  /** One id per pump meter (nozzle), in forecourt order. */
  pumpIds: readonly string[];
  /** The ways customers usually pay, each asked on its own screen (blank means none). */
  namedPayments: readonly string[];
  /** One id per extra payment line the person has added, after the named ways. */
  paymentKeys: readonly string[];
  /** The extra payment lines that first ask who it was for (a customer, or a staff name). */
  paymentWho: readonly string[];
  expenseKeys: readonly string[];
  tankIds: readonly string[];
  /** The differences that need an explanation, in the order they are asked. */
  explain: readonly Difference[];
};

/** Every screen of the figures, in order. A list with no pumps or tanks gets one screen saying so. */
export function buildScreens(input: ScreenInput): FigureScreen[] {
  const screens: FigureScreen[] = [{ id: 'team', step: 'Team' }];
  if (input.hasVisiting) screens.push({ id: 'visiting', step: 'Team' });
  if (input.pumpIds.length === 0) screens.push({ id: 'no-pumps', step: 'Pumps' });
  for (const id of input.pumpIds) screens.push({ id: `pump:${id}`, step: 'Pumps' });
  for (const method of input.namedPayments)
    screens.push({ id: `payname:${method}`, step: 'Payments' });
  for (const key of input.paymentKeys) {
    if (input.paymentWho.includes(key)) screens.push({ id: `paywho:${key}`, step: 'Payments' });
    screens.push({ id: `payment:${key}`, step: 'Payments' });
  }
  screens.push({ id: 'payments-more', step: 'Payments' });
  // An expense is three short questions: what for, how much, and how it was paid.
  for (const key of input.expenseKeys) {
    screens.push({ id: `expense:${key}`, step: 'Expenses' });
    screens.push({ id: `expenseamt:${key}`, step: 'Expenses' });
    screens.push({ id: `expensepay:${key}`, step: 'Expenses' });
  }
  screens.push({ id: 'expenses-more', step: 'Expenses' });
  screens.push({ id: 'cash', step: 'Cash' });
  if (input.tankIds.length === 0) screens.push({ id: 'no-tanks', step: 'Tank dips' });
  for (const id of input.tankIds) screens.push({ id: `tank:${id}`, step: 'Tank dips' });
  for (const difference of input.explain) {
    screens.push({ id: `explain:${difference}`, step: 'Submit' });
  }
  screens.push({ id: 'submit', step: 'Submit' });
  return screens;
}

/** Where a screen is in the list; a screen that is gone (a removed line) counts as the first. */
export function indexOfScreen(screens: readonly FigureScreen[], id: string): number {
  return Math.max(
    0,
    screens.findIndex((screen) => screen.id === id),
  );
}

/** The screen before or after this one, or null at either end. */
export function neighbourScreen(
  screens: readonly FigureScreen[],
  id: string,
  direction: 1 | -1,
): FigureScreen | null {
  return screens[indexOfScreen(screens, id) + direction] ?? null;
}

/** Position on the progress bar. The total grows when a payment or expense line is added. */
export function screenPosition(screens: readonly FigureScreen[], id: string) {
  return { position: indexOfScreen(screens, id) + 1, total: screens.length };
}

/** What the page already holds, used to land on the next unanswered question after a reload. */
export type Answered = {
  /** Who worked has been saved on the server. */
  team: boolean;
  /** Pump ids whose closing reading has been typed (not only the opening shown as a hint). */
  pumps: ReadonlySet<string>;
  /** Payment line keys with an amount. */
  payments: ReadonlySet<string>;
  /** At least one payment line, or nothing was sold. */
  paymentsDone: boolean;
  cash: boolean;
  /** Tank ids that have a dip on this sheet. */
  tanks: ReadonlySet<string>;
  /** Differences already explained. */
  explained: ReadonlySet<Difference>;
};

/** The first screen that has not been answered, or the last one when everything has. */
export function resumeScreen(screens: readonly FigureScreen[], answered: Answered): string {
  for (const screen of screens) {
    const [kind, key] = screen.id.split(':') as [string, string | undefined];
    const done =
      kind === 'team' || kind === 'visiting'
        ? answered.team
        : kind === 'pump'
          ? answered.pumps.has(key!)
          : kind === 'payment'
            ? answered.payments.has(key!)
            : kind === 'payname' || kind === 'payments-more'
              ? answered.paymentsDone
              : kind === 'cash'
                ? answered.cash
                : kind === 'tank'
                  ? answered.tanks.has(key!)
                  : kind === 'explain'
                    ? answered.explained.has(key as Difference)
                    : // No pumps or tanks to ask about, the optional expenses question and the
                      // final screen are never "unanswered".
                      true;
    if (!done) return screen.id;
  }
  return screens[screens.length - 1]?.id ?? 'team';
}

/* ------------------------------ checking answers ------------------------------ */

type Checked = { ok: true } | { ok: false; message: string };
const OK: Checked = { ok: true };
const fail = (message: string): Checked => ({ ok: false, message });

/** Scales a plain decimal to thousandths so two readings compare exactly, without floating point. */
function thousandths(value: string): bigint {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0').slice(0, 3));
}

/** A closing meter reading: a number with up to three decimals, not below the opening reading. */
export function checkClosing(raw: string, opening: string): Checked {
  const value = raw.trim();
  if (!value) return fail('Enter what the meter shows now.');
  if (!/^\d+(\.\d{1,3})?$/.test(value)) {
    return fail('Use numbers only, for example 12345.5. No minus sign and no letters.');
  }
  if (/^\d+(\.\d{1,3})?$/.test(opening.trim()) && thousandths(value) < thousandths(opening)) {
    return fail(
      `The closing reading is lower than the opening reading (${opening.trim()}). Check both numbers.`,
    );
  }
  return OK;
}

/** An amount of money: more than zero, up to four decimals. */
export function checkMoney(raw: string, what = 'the amount'): Checked {
  const value = raw.trim();
  if (!value) return fail(`Enter ${what}.`);
  if (!/^\d+(\.\d{1,4})?$/.test(value)) return fail('Use numbers only, for example 25.50.');
  if (Number(value) <= 0)
    return fail(`${what[0]!.toUpperCase()}${what.slice(1)} must be more than zero.`);
  return OK;
}

/** Cash counted: zero is a real answer (an empty till), so only a missing or odd value is refused. */
export function checkCashCounted(raw: string): Checked {
  const value = raw.trim();
  if (!value) return fail('Enter the cash you counted. Enter 0 if there is none.');
  if (!/^\d+(\.\d{1,4})?$/.test(value)) return fail('Use numbers only, for example 120.50.');
  return OK;
}

export type PaymentLine = {
  method: string;
  amount: string;
  customerAccountId: string;
  beneficiaryName: string;
};

/** Which extra details a payment method needs. */
export function paymentNeeds(method: string): { customer: boolean; beneficiary: boolean } {
  return {
    customer: method === 'CUSTOMER_CREDIT' || method === 'PREPAID',
    beneficiary: method === 'STAFF_OR_MANAGEMENT_FUEL',
  };
}

/** One payment line: how much, and who it was for when the method needs a name. */
export function checkPaymentLine(line: PaymentLine): Record<string, string> {
  const problems: Record<string, string> = {};
  const needs = paymentNeeds(line.method);
  if (needs.customer && !line.customerAccountId) problems.customer = 'Choose the customer.';
  if (needs.beneficiary && !line.beneficiaryName.trim()) {
    problems.beneficiary = 'Enter who received the fuel.';
  }
  const amount = checkMoney(line.amount);
  if (!amount.ok) problems.amount = amount.message;
  return problems;
}

export type ExpenseLine = { category: string; description: string; amount: string };

/** One expense line: what for, details and how much. */
export function checkExpenseLine(line: ExpenseLine): Record<string, string> {
  const problems: Record<string, string> = {};
  if (!line.category.trim()) problems.category = 'Say what the money was for, for example Repairs.';
  if (!line.description.trim()) problems.description = 'Add a few words of detail.';
  const amount = checkMoney(line.amount);
  if (!amount.ok) problems.amount = amount.message;
  return problems;
}

/** The plain question asked for each difference that needs an explanation. */
export const EXPLAIN_QUESTION: Record<Difference, string> = {
  SALES: 'Why is the sales figure different?',
  CASH: 'Why is the cash different?',
  STOCK: 'Why is the stock different?',
};
