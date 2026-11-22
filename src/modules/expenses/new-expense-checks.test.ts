import { describe, expect, it } from 'vitest';
import {
  checkExpenseMoney,
  checkExpensePaid,
  checkExpenseWhat,
  checkRegularMoney,
  checkRegularWhat,
} from './new-expense-checks';

describe('new expense checks', () => {
  it('needs a kind and a description', () => {
    expect(checkExpenseWhat('', ' ')).toHaveProperty('expense-category');
    expect(checkExpenseWhat('', ' ')).toHaveProperty('expense-description');
    expect(checkExpenseWhat('c1', 'Pump hose')).toEqual({});
  });

  it('needs an amount, a date and, when asked, a station', () => {
    expect(checkExpenseMoney('', '', '', true)).toHaveProperty('expense-amount');
    expect(checkExpenseMoney('0', '2026-11-01', 's1', true)).toHaveProperty('expense-amount');
    expect(checkExpenseMoney('25.50', '', 's1', true)).toHaveProperty('expense-date');
    expect(checkExpenseMoney('25.50', '2026-11-01', '', true)).toHaveProperty('expense-station');
    expect(checkExpenseMoney('25.50', '2026-11-01', '', false)).toEqual({});
    expect(checkExpensePaid('', true)).toHaveProperty('expense-station');
    expect(checkExpensePaid('', false)).toEqual({});
    expect(checkExpensePaid('s1', true)).toEqual({});
  });

  it('checks a regular cost', () => {
    expect(checkRegularWhat('', '', '')).toHaveProperty('regular-name');
    expect(checkRegularWhat('Rent', 'c1', 's1')).toEqual({});
    expect(checkRegularMoney('450', '2026-11-01', '')).toEqual({});
    expect(checkRegularMoney('', '', '')).toHaveProperty('regular-amount');
    expect(checkRegularMoney('450', '2026-11-10', '2026-11-01')).toHaveProperty('regular-end');
  });
});
