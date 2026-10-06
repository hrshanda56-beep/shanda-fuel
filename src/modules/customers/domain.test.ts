import { describe, expect, it } from 'vitest';
import {
  assertSourceReferenceUnused,
  assertCustomerAccountTransactionAllowed,
  assertCreditAccountHasPositiveLimit,
  cancelCustomerFuelAuthorization,
  createCustomerPaymentEntry,
  createPrepaidTopUpEntry,
  deriveAccountBalance,
  newCustomerAccount,
  recordCustomerFuelUse,
  requestCustomerFuelAuthorization,
  reserveCustomerFuelAuthorization,
  type ActiveReservation,
  type CustomerAccount,
  type CustomerFuelValue,
  type CustomerLedgerEntry,
} from './index';
import { litres, money } from '../../platform/domain/primitives';

const ids = {
  tenant: 'tenant-a',
  customer: 'customer-a',
  credit: 'account-credit',
  prepaidValue: 'account-prepaid-value',
  prepaidLitres: 'account-prepaid-litres',
  diesel: 'product-diesel',
  petrol: 'product-petrol',
};

function account(accountType: CustomerAccount['accountType'], id?: string): CustomerAccount {
  return newCustomerAccount({
    id: id ?? accountType,
    tenantId: ids.tenant,
    customerId: ids.customer,
    accountType,
    currency: 'USD',
    ...(accountType === 'CREDIT' ? { creditLimit: money('100.0000') } : {}),
  });
}

function fuel(productId: string, amount: string, quantity: string): CustomerFuelValue {
  return { productId, amount: money(amount), litres: litres(quantity) };
}

function source(sourceId: string) {
  return { sourceType: 'MANUAL_ADJUSTMENT' as const, sourceId };
}

function topUpEntry(
  target: CustomerAccount,
  input: { amount?: string; productId?: string; litres?: string; id: string },
): CustomerLedgerEntry {
  return createPrepaidTopUpEntry({
    id: input.id,
    account: target,
    amount: input.amount ? money(input.amount) : undefined,
    productId: input.productId,
    quantityLitres: input.litres ? litres(input.litres) : undefined,
    source: source(input.id),
    occurredAt: '2026-09-23T06:00:00Z',
    businessDate: '2026-09-23',
  });
}

function authorization(target: CustomerAccount, requested: CustomerFuelValue) {
  return requestCustomerFuelAuthorization({
    id: `authorization-${target.id}`,
    account: target,
    stationId: 'station-a',
    requested,
    requestedBy: 'membership-a',
    requestedAt: '2026-09-23T07:00:00Z',
    source: source(`authorization-${target.id}`),
  });
}

describe('customer account domain', () => {
  it('requires a positive limit before a credit account can be enabled', () => {
    expect(() =>
      newCustomerAccount({
        id: ids.credit,
        tenantId: ids.tenant,
        customerId: ids.customer,
        accountType: 'CREDIT',
        currency: 'USD',
      }),
    ).toThrow('Credit accounts require a positive credit limit');

    expect(() =>
      newCustomerAccount({
        id: ids.credit,
        tenantId: ids.tenant,
        customerId: ids.customer,
        accountType: 'CREDIT',
        currency: 'USD',
        creditLimit: money('0.0000'),
      }),
    ).toThrow('Credit limit must be positive');
  });

  it('fails closed when a legacy credit account has no positive limit', () => {
    const legacyAccount: CustomerAccount = { ...account('CREDIT'), creditLimit: undefined };
    expect(() => assertCreditAccountHasPositiveLimit(legacyAccount)).toThrow(
      'Credit account is disabled without a positive credit limit',
    );
    expect(() =>
      requestCustomerFuelAuthorization({
        id: 'legacy-authorization',
        account: legacyAccount,
        stationId: 'station-a',
        requested: fuel(ids.diesel, '1.0000', '1.000'),
        requestedBy: 'membership-a',
        requestedAt: '2026-09-23T07:00:00Z',
        source: source('legacy-authorization'),
      }),
    ).toThrow('Credit account is disabled without a positive credit limit');
    expect(() =>
      reserveCustomerFuelAuthorization({
        authorization: authorization(legacyAccount, fuel(ids.diesel, '1.0000', '1.000')),
        account: legacyAccount,
        entries: [],
        activeReservations: [],
      }),
    ).toThrow('Credit account is disabled without a positive credit limit');
  });

  it('blocks credit authorization above the configured hard cap', () => {
    const target = newCustomerAccount({
      id: ids.credit,
      tenantId: ids.tenant,
      customerId: ids.customer,
      accountType: 'CREDIT',
      currency: 'USD',
      creditLimit: money('10.0000'),
    });
    expect(() =>
      reserveCustomerFuelAuthorization({
        authorization: authorization(target, fuel(ids.diesel, '10.0001', '1.000')),
        account: target,
        entries: [],
        activeReservations: [],
      }),
    ).toThrow('Credit authorization exceeds the configured credit limit');
  });

  it('allows account transactions only for active customers and accounts', () => {
    expect(() => assertCustomerAccountTransactionAllowed('SUSPENDED', 'ACTIVE')).toThrow(
      'require an active customer and customer account',
    );
    expect(() => assertCustomerAccountTransactionAllowed('ACTIVE', 'CLOSED')).toThrow(
      'require an active customer and customer account',
    );
    expect(() => assertCustomerAccountTransactionAllowed('ACTIVE', 'ACTIVE')).not.toThrow();
  });

  it('derives a credit receivable from charges and payments without mutable balance state', () => {
    const target = account('CREDIT', ids.credit);
    const charge = recordCustomerFuelUse({
      authorization: reserveCustomerFuelAuthorization({
        authorization: authorization(target, fuel(ids.diesel, '12.3456', '7.111')),
        account: target,
        entries: [],
        activeReservations: [],
      }),
      account: target,
      used: fuel(ids.diesel, '12.3456', '7.111'),
      entryId: 'credit-charge',
      source: { sourceType: 'A5_RECONCILIATION_CUSTOMER_FUEL', sourceId: 'a5-payment-1' },
      occurredAt: '2026-09-23T08:00:00Z',
      businessDate: '2026-09-23',
      fuelAllocationId: 'a5-allocation-1',
    }).ledgerEntry;
    const payment = createCustomerPaymentEntry({
      id: 'customer-payment-1',
      account: target,
      amount: money('2.3456'),
      source: { sourceType: 'CUSTOMER_PAYMENT', sourceId: 'payment-1' },
      occurredAt: '2026-09-23T09:00:00Z',
      businessDate: '2026-09-23',
    });

    const balance = deriveAccountBalance(target, [charge, payment]);
    expect(balance.accountType).toBe('CREDIT');
    if (balance.accountType === 'CREDIT') expect(balance.amount.amount.toString()).toBe('10');
  });

  it('derives prepaid value and rejects a reservation that would overdraw it', () => {
    const target = account('PREPAID_VALUE', ids.prepaidValue);
    const entries = [topUpEntry(target, { id: 'value-topup', amount: '100.0000' })];
    const first = reserveCustomerFuelAuthorization({
      authorization: authorization(target, fuel(ids.diesel, '80.0000', '50.000')),
      account: target,
      entries,
      activeReservations: [],
    });
    const active: ActiveReservation = {
      accountId: target.id,
      accountType: target.accountType,
      remaining: first.remaining,
      state: 'AUTHORIZED',
    };

    expect(() =>
      reserveCustomerFuelAuthorization({
        authorization: requestCustomerFuelAuthorization({
          id: 'authorization-second',
          account: target,
          stationId: 'station-a',
          requested: fuel(ids.diesel, '30.0000', '10.000'),
          requestedBy: 'membership-a',
          requestedAt: '2026-09-23T07:01:00Z',
          source: source('authorization-second'),
        }),
        account: target,
        entries,
        activeReservations: [active],
      }),
    ).toThrow('Prepaid value is insufficient');
  });

  it('keeps prepaid litres isolated by product', () => {
    const target = account('PREPAID_LITRES', ids.prepaidLitres);
    const entries = [
      topUpEntry(target, { id: 'diesel-topup', productId: ids.diesel, litres: '100.000' }),
      topUpEntry(target, { id: 'petrol-topup', productId: ids.petrol, litres: '20.000' }),
    ];
    const balance = deriveAccountBalance(target, entries);
    expect(balance.accountType).toBe('PREPAID_LITRES');
    if (balance.accountType === 'PREPAID_LITRES') {
      expect(balance.productBalances).toEqual([
        { productId: ids.diesel, litres: litres('100') },
        { productId: ids.petrol, litres: litres('20') },
      ]);
    }

    expect(() =>
      reserveCustomerFuelAuthorization({
        authorization: authorization(target, fuel(ids.petrol, '30.0000', '21.000')),
        account: target,
        entries,
        activeReservations: [],
      }),
    ).toThrow('Prepaid litres are insufficient');
  });

  it('records partial usage and leaves the exact reservation remainder', () => {
    const target = account('PREPAID_VALUE', ids.prepaidValue);
    const entries = [topUpEntry(target, { id: 'partial-topup', amount: '25.0000' })];
    const reserved = reserveCustomerFuelAuthorization({
      authorization: authorization(target, fuel(ids.diesel, '10.0000', '5.000')),
      account: target,
      entries,
      activeReservations: [],
    });
    const result = recordCustomerFuelUse({
      authorization: reserved,
      account: target,
      used: fuel(ids.diesel, '4.1250', '2.250'),
      entryId: 'partial-usage',
      source: { sourceType: 'A5_RECONCILIATION_CUSTOMER_FUEL', sourceId: 'a5-partial-1' },
      occurredAt: '2026-09-23T08:00:00Z',
      businessDate: '2026-09-23',
      fuelAllocationId: 'allocation-partial-1',
    });

    expect(result.authorization.state).toBe('PARTIALLY_USED');
    expect(result.authorization.remaining.amount.amount.toString()).toBe('5.875');
    expect(result.authorization.remaining.litres.toString()).toBe('2.75');
    expect(result.ledgerEntry.entryType).toBe('PREPAID_FUEL_USAGE');
  });

  it('releases remaining capacity on cancellation and requires a reason', () => {
    const target = account('PREPAID_VALUE', ids.prepaidValue);
    const reserved = reserveCustomerFuelAuthorization({
      authorization: authorization(target, fuel(ids.diesel, '50.0000', '20.000')),
      account: target,
      entries: [topUpEntry(target, { id: 'cancel-topup', amount: '50.0000' })],
      activeReservations: [],
    });
    expect(() => cancelCustomerFuelAuthorization(reserved, '')).toThrow('Cancellation reason');
    const cancelled = cancelCustomerFuelAuthorization(reserved, 'Customer cancelled request');
    expect(cancelled.state).toBe('CANCELLED');
    expect(cancelled.remaining.amount.amount.toString()).toBe('0');
    expect(cancelled.remaining.litres.toString()).toBe('0');
  });

  it('rejects duplicate source references before persistence', () => {
    const target = account('PREPAID_VALUE', ids.prepaidValue);
    const entry = topUpEntry(target, { id: 'source-entry', amount: '10.0000' });
    expect(() => assertSourceReferenceUnused([entry], entry.source)).toThrow('already been posted');
  });
});
