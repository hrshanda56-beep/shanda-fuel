import { describe, expect, it } from 'vitest';
import {
  newCustomerAccount,
  requestCustomerFuelAuthorization,
  reserveCustomerFuelAuthorization,
  type CustomerLedgerEntry,
} from './index';
import { buildCustomerAlertFacts } from './alert-facts';
import { buildStaffBenefitRows } from './staff-benefit-rows';
import { createCustomerAccountSchema } from './validation';
import { litres, money } from '../../platform/domain/primitives';

const account = newCustomerAccount({
  id: 'acc',
  tenantId: 't',
  customerId: 'c',
  accountType: 'CREDIT',
  currency: 'USD',
  creditLimit: money('100.0000'),
});

function entry(
  id: string,
  entryType: 'CREDIT_FUEL_CHARGE' | 'CUSTOMER_PAYMENT',
  direction: 'INCREASE' | 'DECREASE',
  amount: string,
  businessDate: string,
): CustomerLedgerEntry {
  return {
    id,
    tenantId: 't',
    customerId: 'c',
    accountId: 'acc',
    accountType: 'CREDIT',
    entryType,
    direction,
    amount: money(amount),
    source: { sourceType: 'MANUAL_ADJUSTMENT', sourceId: id },
    occurredAt: `${businessDate}T08:00:00Z`,
    businessDate: businessDate as never,
  };
}

const request = (amount: string) =>
  requestCustomerFuelAuthorization({
    id: 'auth',
    account,
    stationId: 's',
    requested: { productId: 'p', amount: money(amount), litres: litres('1.000') },
    requestedBy: 'm',
    requestedAt: '2026-10-20T08:00:00Z',
    source: { sourceType: 'MANUAL_ADJUSTMENT', sourceId: 'auth' },
  });

describe('staff fuel benefit at authorization', () => {
  const entries = [
    entry('c1', 'CREDIT_FUEL_CHARGE', 'INCREASE', '90.0000', '2026-10-02'),
    entry('p1', 'CUSTOMER_PAYMENT', 'DECREASE', '90.0000', '2026-10-03'),
  ];

  it('a paid-off balance does not give the month back', () => {
    expect(() =>
      reserveCustomerFuelAuthorization({
        authorization: request('20.0000'),
        account,
        entries,
        activeReservations: [],
        staffBenefit: { asAt: '2026-10-20' },
      }),
    ).toThrow(/fuel benefit/);
  });

  it('the same request is allowed for an ordinary credit account, and in the next month', () => {
    expect(() =>
      reserveCustomerFuelAuthorization({
        authorization: request('20.0000'),
        account,
        entries,
        activeReservations: [],
      }),
    ).not.toThrow();
    expect(() =>
      reserveCustomerFuelAuthorization({
        authorization: request('20.0000'),
        account,
        entries,
        activeReservations: [],
        staffBenefit: { asAt: '2026-11-01' },
      }),
    ).not.toThrow();
  });
});

describe('staff benefit creation contract', () => {
  const base = {
    commandType: 'CreateCustomerAccount' as const,
    tenantId: '00000000-0000-4000-8000-000000000001',
    customerId: '00000000-0000-4000-8000-000000000002',
    currency: 'USD',
    creditLimit: '60.0000',
    staffBenefit: { staffName: 'Tendai Moyo' },
  };
  it('needs a credit account in US dollars and a name', () => {
    expect(
      createCustomerAccountSchema.parse({ ...base, accountType: 'CREDIT' }).staffBenefit,
    ).toEqual({
      staffName: 'Tendai Moyo',
    });
    expect(() =>
      createCustomerAccountSchema.parse({
        ...base,
        accountType: 'PREPAID_VALUE',
        creditLimit: undefined,
      }),
    ).toThrow();
    expect(() =>
      createCustomerAccountSchema.parse({ ...base, accountType: 'CREDIT', currency: 'ZWL' }),
    ).toThrow(/US dollars/);
    expect(() =>
      createCustomerAccountSchema.parse({
        ...base,
        accountType: 'CREDIT',
        staffBenefit: { staffName: ' ' },
      }),
    ).toThrow();
  });
});

const line = (id: string, direction: 'INCREASE' | 'DECREASE', amount: string, d: string) => ({
  id,
  direction,
  entryType: direction === 'INCREASE' ? 'CREDIT_FUEL_CHARGE' : 'CUSTOMER_PAYMENT',
  businessDate: d,
  amount,
});

describe('customer alert facts', () => {
  it('finds overdue by the oldest unpaid charge and over-limit exactly', () => {
    const facts = buildCustomerAlertFacts(
      [
        {
          accountId: 'a1',
          customerId: 'c1',
          customerName: 'Acme',
          limit: '100',
          isStaffBenefit: false,
          staffName: null,
          // 60 paid against 40 (old) + 70 (new): the old charge is cleared first.
          lines: [
            line('x', 'INCREASE', '40', '2026-08-01'),
            line('y', 'INCREASE', '70', '2026-10-10'),
            line('z', 'DECREASE', '60', '2026-10-11'),
          ],
        },
        {
          accountId: 'a2',
          customerId: 'c2',
          customerName: 'Fuel desk',
          limit: '50',
          isStaffBenefit: true,
          staffName: 'Tendai Moyo',
          lines: [
            line('s1', 'INCREASE', '40', '2026-10-02'),
            line('s2', 'DECREASE', '40', '2026-10-03'),
            line('s3', 'INCREASE', '15', '2026-10-04'),
          ],
        },
      ],
      '2026-10-20',
    );
    expect(facts.overdue.find((r) => r.accountId === 'a1')).toMatchObject({
      oldestUnpaidDate: '2026-10-10',
      owed: '50.0000',
    });
    expect(facts.overLimit).toEqual([
      expect.objectContaining({
        accountId: 'a2',
        kind: 'STAFF_BENEFIT_MONTH',
        amount: '55.0000',
        customerName: 'Tendai Moyo',
      }),
    ]);
  });
});

describe('staff benefit rows', () => {
  it('shows no use when the month cannot be worked out', () => {
    const [row] = buildStaffBenefitRows(
      [
        {
          accountId: 'a',
          customerId: 'c',
          customerName: 'n',
          accountReference: 'C-1',
          staffName: 'T',
          status: 'ACTIVE',
          limit: '60.0000',
          today: null,
        },
      ],
      new Map([['a', [line('1', 'INCREASE', '10', '2026-10-01')]]]),
    );
    expect(row!.use).toBeNull();
    expect(row!.balance).toBe('10.0000');
  });
});
