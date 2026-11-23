import { describe, expect, it } from 'vitest';

import { parseOpeningBalanceCsv } from './domain';
import {
  BLANK_OPENING,
  buildOpeningCsv,
  checkAmount,
  checkAsOf,
  checkBalance,
  checkDue,
  checkLitres,
  checkPick,
  checkReference,
  countEntered,
  describeIssues,
  isCalendarDay,
  isEmpty,
  tanksWithoutValue,
  todo,
  type OpeningAnswers,
  type OpeningOptions,
} from './wizard';

const options: OpeningOptions = {
  station: {
    id: 's1',
    code: 'HARARE',
    name: 'Harare Road',
    companyReference: 'TEI Oils (Pvt) Ltd',
    companyName: 'TEI Oils (Pvt) Ltd',
  },
  tanks: [
    { code: 'T1', fuel: 'Diesel', capacityLitres: '50000.000', hasOpening: false },
    { code: 'T2', fuel: 'Petrol', capacityLitres: '40000.000', hasOpening: true },
  ],
  cashLocations: [{ code: 'SAFE', name: 'Main safe', hasOpening: false }],
  bankAccounts: [{ name: 'CBZ, main', bankName: 'CBZ', hasOpening: false }],
  customers: [
    {
      accountId: '11111111-1111-4111-8111-111111111111',
      name: 'Moyo Transport',
      hasOpening: false,
    },
    { accountId: '22222222-2222-4222-8222-222222222222', name: 'Dube Haulage', hasOpening: true },
  ],
  suppliers: [{ code: 'ZUVA', name: 'Zuva "Petroleum" Ltd' }],
};

const everything: OpeningAnswers = {
  asOf: '2026-11-20',
  tanks: { T1: { litres: '12,500.5', value: '' } },
  cash: { SAFE: '1500' },
  bank: { 'CBZ, main': '0' },
  customers: [
    {
      accountId: '11111111-1111-4111-8111-111111111111',
      name: 'Moyo Transport',
      amount: '320.50',
      due: '2026-12-15',
    },
  ],
  suppliers: [
    { code: 'ZUVA', name: 'Zuva "Petroleum" Ltd', reference: 'INV-1, A', amount: '900', due: '' },
  ],
};

describe('the checks', () => {
  it('knows a real day', () => {
    expect(isCalendarDay('2026-11-20')).toBe(true);
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(checkAsOf('')).toHaveProperty('asOf');
    expect(checkAsOf('2026-11-20')).toEqual({});
  });

  it('needs litres that fit the tank, and a value only if it is a real amount', () => {
    expect(checkLitres({ litres: '', value: '' }, '50000')).toHaveProperty('litres');
    expect(checkLitres({ litres: '0', value: '' }, '50000')).toHaveProperty('litres');
    expect(checkLitres({ litres: '12.3456', value: '' }, '50000')).toHaveProperty('litres');
    expect(checkLitres({ litres: '60000', value: '' }, '50000').litres).toContain('50,000');
    expect(checkLitres({ litres: '1,200.5', value: '' }, '50000')).toEqual({});
    expect(checkLitres({ litres: '10', value: '-3' }, '50000')).toHaveProperty('value');
    expect(checkLitres({ litres: '10', value: '0' }, '50000')).toHaveProperty('value');
    expect(checkLitres({ litres: '10', value: '800' }, '50000')).toEqual({});
  });

  it('needs an amount above zero, except a bank balance which may be zero', () => {
    expect(checkAmount('', 'the cash')).toHaveProperty('amount');
    expect(checkAmount('0', 'the cash')).toHaveProperty('amount');
    expect(checkAmount('abc', 'the cash')).toHaveProperty('amount');
    expect(checkAmount('1.23456', 'the cash')).toHaveProperty('amount');
    expect(checkAmount('150.5', 'the cash')).toEqual({});
    expect(checkBalance('0')).toEqual({});
    expect(checkBalance('')).toHaveProperty('amount');
  });

  it('keeps a due day real and not before the figures day', () => {
    expect(checkDue('', '2026-11-20')).toEqual({});
    expect(checkDue('2026-13-01', '2026-11-20')).toHaveProperty('due');
    expect(checkDue('2026-11-01', '2026-11-20')).toHaveProperty('due');
    expect(checkDue('2026-11-20', '2026-11-20')).toEqual({});
  });

  it('keeps an invoice reference present, short and new', () => {
    expect(checkReference('', [])).toHaveProperty('reference');
    expect(checkReference('x'.repeat(81), [])).toHaveProperty('reference');
    expect(checkReference(' inv-1 ', ['INV-1'])).toHaveProperty('reference');
    expect(checkReference('INV-2', ['INV-1'])).toEqual({});
  });

  it('needs a pick', () => {
    expect(checkPick(null, 'a customer')).toHaveProperty('pick');
    expect(checkPick('x', 'a customer')).toEqual({});
  });
});

describe('what is asked', () => {
  it('leaves out what already has an opening figure', () => {
    const left = todo(options);
    expect(left.tank.map((t) => t.code)).toEqual(['T1']);
    expect(left.cash).toHaveLength(1);
    expect(left.customers.map((c) => c.name)).toEqual(['Moyo Transport']);
    expect(
      todo({ ...options, bankAccounts: [{ ...options.bankAccounts[0]!, hasOpening: true }] }).bank,
    ).toEqual([]);
  });

  it('notices when nothing was entered', () => {
    expect(isEmpty(BLANK_OPENING)).toBe(true);
    expect(isEmpty(everything)).toBe(false);
    expect(countEntered(everything)).toBe(5);
  });
});

describe('a tank entered without a value', () => {
  const tank = (litres: string, value: string): OpeningAnswers => ({
    ...BLANK_OPENING,
    tanks: { T1: { litres, value } },
  });

  it('is named, because the station cannot go live until the value is added', () => {
    expect(tanksWithoutValue(options, tank('1000', ''))).toEqual(['Tank 1']);
    expect(tanksWithoutValue(options, tank('1000', '  '))).toEqual(['Tank 1']);
  });

  it('is not named when it has a value, or when the tank is empty', () => {
    expect(tanksWithoutValue(options, tank('1000', '1500'))).toEqual([]);
    expect(tanksWithoutValue(options, tank('0', ''))).toEqual([]);
    expect(tanksWithoutValue(options, BLANK_OPENING)).toEqual([]);
  });
});

describe('the import file', () => {
  it('is exactly what the spreadsheet import reads, with no problems', () => {
    const { csv } = buildOpeningCsv(options, everything);
    const parsed = parseOpeningBalanceCsv(csv);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows.map((r) => r.lineType)).toEqual([
      'TANK_STOCK',
      'CASH_BALANCE',
      'BANK_BALANCE',
      'CUSTOMER_CHARGE',
      'SUPPLIER_INVOICE',
    ]);
  });

  it('writes each figure to the right column', () => {
    const { rows } = parseOpeningBalanceCsv(buildOpeningCsv(options, everything).csv);
    const [tank, cash, bank, customer, supplier] = rows;
    expect(tank).toMatchObject({
      stationCode: 'HARARE',
      tankCode: 'T1',
      quantityLitres: '12500.500',
      effectiveDate: '2026-11-20',
    });
    expect(cash).toMatchObject({
      stationCode: 'HARARE',
      cashLocationCode: 'SAFE',
      amount: '1500.0000',
    });
    expect(bank).toMatchObject({
      legalEntityReference: 'TEI Oils (Pvt) Ltd',
      bankAccountName: 'CBZ, main',
      amount: '0.0000',
    });
    expect(customer).toMatchObject({
      accountReference: '11111111-1111-4111-8111-111111111111',
      amount: '320.5000',
      dueDate: '2026-12-15',
    });
    // A comma and quotes in a name or reference survive the file.
    expect(supplier).toMatchObject({
      supplierCode: 'ZUVA',
      reference: 'INV-1, A',
      amount: '900.0000',
      dueDate: null,
    });
  });

  it('adds a tank value only when one was entered', () => {
    const { rows } = parseOpeningBalanceCsv(
      buildOpeningCsv(options, {
        ...BLANK_OPENING,
        asOf: '2026-11-20',
        tanks: { T1: { litres: '100', value: '250.5' } },
      }).csv,
    );
    expect(rows[0]!.inventoryValue).toBe('250.5000');
  });

  it('skips tanks with no entry and never writes the tank that already has a figure', () => {
    const { csv } = buildOpeningCsv(options, {
      ...BLANK_OPENING,
      asOf: '2026-11-20',
      tanks: { T2: { litres: '5', value: '' } },
    });
    // T2 is in the options, so an entry for it would be written; the wizard never offers it.
    expect(parseOpeningBalanceCsv(csv).rows).toHaveLength(1);
    expect(buildOpeningCsv(options, { ...BLANK_OPENING, asOf: '2026-11-20' }).lines).toEqual([]);
  });

  it('names each figure in plain words for the check screen', () => {
    const { lines } = buildOpeningCsv(options, everything);
    expect(lines.map((l) => [l.kind, l.label, l.amount])).toEqual([
      ['Fuel in tank', 'Tank 1 (Diesel)', '12,500.5 litres'],
      ['Cash', 'Main safe', '$1,500.00'],
      ['Bank', 'CBZ, main (CBZ)', '$0.00'],
      ['Customer owes', 'Moyo Transport', '$320.50'],
      ['Unpaid invoice', 'Zuva "Petroleum" Ltd, invoice INV-1, A', '$900.00'],
    ]);
  });
});

describe('the server problems, in plain words', () => {
  it('names the figure a problem belongs to', () => {
    const { lines } = buildOpeningCsv(options, everything);
    expect(
      describeIssues(lines, [
        {
          lineNumber: 2,
          field: 'tank_code',
          message: 'This tank already has an opening stock balance.',
        },
        { lineNumber: 4, field: 'amount', message: 'amount has too many digits.' },
        { lineNumber: null, field: null, message: 'The CSV file is empty.' },
      ]),
    ).toEqual([
      'Tank 1 (Diesel): This tank already has an opening stock balance.',
      'CBZ, main (CBZ): amount has too many digits.',
      'The CSV file is empty.',
    ]);
  });
});
