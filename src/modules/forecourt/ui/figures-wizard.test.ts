import { describe, expect, it } from 'vitest';

import {
  buildScreens,
  checkCashCounted,
  checkClosing,
  checkExpenseLine,
  checkMoney,
  checkPaymentLine,
  indexOfScreen,
  neighbourScreen,
  paymentNeeds,
  resumeScreen,
  screenPosition,
  type Answered,
  type ScreenInput,
} from './figures-wizard';

const input = (over: Partial<ScreenInput> = {}): ScreenInput => ({
  hasVisiting: false,
  pumpIds: ['a', 'b'],
  paymentKeys: [],
  expenseKeys: [],
  tankIds: ['t1'],
  explain: [],
  ...over,
});

const ids = (over: Partial<ScreenInput> = {}) => buildScreens(input(over)).map((s) => s.id);

describe('figures wizard: the screens and their order', () => {
  it('asks team, pumps, payments, expenses, cash, tank dips, then submit', () => {
    expect(ids()).toEqual([
      'team',
      'pump:a',
      'pump:b',
      'payments-more',
      'expenses-more',
      'cash',
      'tank:t1',
      'submit',
    ]);
  });

  it('adds a screen for visiting staff only when there are some', () => {
    expect(ids({ hasVisiting: true }).slice(0, 2)).toEqual(['team', 'visiting']);
    expect(ids()).not.toContain('visiting');
  });

  it('gives each payment and expense line its own screen before the "another?" question', () => {
    const result = ids({ paymentKeys: ['p1', 'p2'], expenseKeys: ['e1'] });
    expect(result.indexOf('payment:p1')).toBeLessThan(result.indexOf('payment:p2'));
    expect(result.indexOf('payment:p2')).toBeLessThan(result.indexOf('payments-more'));
    expect(result.indexOf('expense:e1')).toBeLessThan(result.indexOf('expenses-more'));
    expect(result.indexOf('payments-more')).toBeLessThan(result.indexOf('expense:e1'));
  });

  it('says so when there are no pumps or tanks, and asks for each explanation before submit', () => {
    const result = ids({ pumpIds: [], tankIds: [], explain: ['SALES', 'STOCK'] });
    expect(result).toContain('no-pumps');
    expect(result).toContain('no-tanks');
    expect(result.slice(-3)).toEqual(['explain:SALES', 'explain:STOCK', 'submit']);
  });

  it('keeps every step in order, so the step name never goes backwards', () => {
    const order = ['Team', 'Pumps', 'Payments', 'Expenses', 'Cash', 'Tank dips', 'Submit'];
    const steps = buildScreens(
      input({ hasVisiting: true, paymentKeys: ['p'], expenseKeys: ['e'], explain: ['CASH'] }),
    ).map((s) => order.indexOf(s.step));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it('moves between neighbours and stops at both ends', () => {
    const screens = buildScreens(input());
    expect(neighbourScreen(screens, 'team', -1)).toBeNull();
    expect(neighbourScreen(screens, 'team', 1)?.id).toBe('pump:a');
    expect(neighbourScreen(screens, 'submit', 1)).toBeNull();
    expect(neighbourScreen(screens, 'submit', -1)?.id).toBe('tank:t1');
  });

  it('treats a screen that no longer exists as the first, and counts positions from 1', () => {
    const screens = buildScreens(input());
    expect(indexOfScreen(screens, 'payment:gone')).toBe(0);
    expect(screenPosition(screens, 'pump:b')).toEqual({ position: 3, total: screens.length });
  });
});

describe('figures wizard: where to resume', () => {
  const none: Answered = {
    team: false,
    pumps: new Set(),
    payments: new Set(),
    paymentsDone: false,
    cash: false,
    tanks: new Set(),
    explained: new Set(),
  };
  const screens = buildScreens(input({ paymentKeys: ['p1'], explain: ['CASH'] }));

  it('starts at the team when nothing is saved', () => {
    expect(resumeScreen(screens, none)).toBe('team');
  });

  it('goes to the first pump without a closing reading', () => {
    expect(resumeScreen(screens, { ...none, team: true, pumps: new Set(['a']) })).toBe('pump:b');
  });

  it('then to a payment line with no amount, and to the payments question', () => {
    const afterPumps = { ...none, team: true, pumps: new Set(['a', 'b']) };
    expect(resumeScreen(screens, afterPumps)).toBe('payment:p1');
    expect(resumeScreen(screens, { ...afterPumps, payments: new Set(['p1']) })).toBe(
      'payments-more',
    );
  });

  it('then to the cash, the tank dips and the explanations', () => {
    const upToCash = {
      ...none,
      team: true,
      pumps: new Set(['a', 'b']),
      payments: new Set(['p1']),
      paymentsDone: true,
    };
    expect(resumeScreen(screens, upToCash)).toBe('cash');
    expect(resumeScreen(screens, { ...upToCash, cash: true })).toBe('tank:t1');
    expect(resumeScreen(screens, { ...upToCash, cash: true, tanks: new Set(['t1']) })).toBe(
      'explain:CASH',
    );
  });

  it('lands on the submit screen when everything is answered', () => {
    expect(
      resumeScreen(screens, {
        team: true,
        pumps: new Set(['a', 'b']),
        payments: new Set(['p1']),
        paymentsDone: true,
        cash: true,
        tanks: new Set(['t1']),
        explained: new Set(['CASH']),
      }),
    ).toBe('submit');
  });
});

describe('figures wizard: checking answers', () => {
  it('accepts a closing reading at or above the opening reading, exactly', () => {
    expect(checkClosing('1000.500', '1000.500').ok).toBe(true);
    expect(checkClosing('1000.501', '1000.500').ok).toBe(true);
    expect(checkClosing('999.999', '1000.000')).toMatchObject({ ok: false });
  });

  it('compares large readings without rounding', () => {
    expect(checkClosing('123456789012.001', '123456789012.000').ok).toBe(true);
    expect(checkClosing('123456789012.000', '123456789012.001').ok).toBe(false);
  });

  it('refuses an empty, negative or non-numeric closing reading', () => {
    for (const value of ['', '  ', '-1', '12a', '1,5', '1.2345']) {
      expect(checkClosing(value, '0').ok, value).toBe(false);
    }
  });

  it('refuses money that is empty, zero or odd, and accepts up to four decimals', () => {
    for (const value of ['', '0', '0.00', '-5', 'ten', '1.23456']) {
      expect(checkMoney(value).ok, value).toBe(false);
    }
    for (const value of ['5', '25.50', '0.0001', '1000000']) {
      expect(checkMoney(value).ok, value).toBe(true);
    }
  });

  it('accepts zero cash counted but not a missing figure', () => {
    expect(checkCashCounted('0').ok).toBe(true);
    expect(checkCashCounted('120.5').ok).toBe(true);
    expect(checkCashCounted('')).toMatchObject({ ok: false });
    expect(checkCashCounted('abc').ok).toBe(false);
  });

  it('asks for the extra detail each payment method needs', () => {
    expect(paymentNeeds('CASH')).toEqual({ customer: false, beneficiary: false });
    expect(paymentNeeds('CUSTOMER_CREDIT').customer).toBe(true);
    expect(paymentNeeds('PREPAID').customer).toBe(true);
    expect(paymentNeeds('STAFF_OR_MANAGEMENT_FUEL').beneficiary).toBe(true);
    const base = { amount: '10', customerAccountId: '', beneficiaryName: '' };
    expect(checkPaymentLine({ ...base, method: 'CASH' })).toEqual({});
    expect(checkPaymentLine({ ...base, method: 'CUSTOMER_CREDIT' })).toEqual({
      customer: 'Choose the customer.',
    });
    expect(checkPaymentLine({ ...base, method: 'STAFF_OR_MANAGEMENT_FUEL' })).toEqual({
      beneficiary: 'Enter who received the fuel.',
    });
    expect(checkPaymentLine({ ...base, method: 'CASH', amount: '' })).toHaveProperty('amount');
  });

  it('asks for what an expense was for, a detail and an amount', () => {
    expect(checkExpenseLine({ category: 'Repairs', description: 'Hose', amount: '12' })).toEqual(
      {},
    );
    expect(checkExpenseLine({ category: ' ', description: '', amount: '' })).toEqual({
      category: expect.any(String),
      description: expect.any(String),
      amount: expect.any(String),
    });
  });
});
