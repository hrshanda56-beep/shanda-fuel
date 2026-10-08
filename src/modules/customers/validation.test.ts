import { describe, expect, it } from 'vitest';
import {
  createCustomerAccountSchema,
  customerStatementQuerySchema,
  recordCustomerPaymentSchema,
  recordPrepaidTopUpSchema,
  setCustomerAccountStationsSchema,
  setCustomerLegalEntitySchema,
} from './validation';

const ids = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  customerId: '00000000-0000-4000-8000-000000000002',
  accountId: '00000000-0000-4000-8000-000000000003',
  productId: '00000000-0000-4000-8000-000000000004',
};

const source = {
  sourceType: 'PREPAID_TOPUP' as const,
  sourceId: '00000000-0000-4000-8000-000000000005',
};

describe('customer command validation contracts', () => {
  it('requires a positive limit for credit accounts', () => {
    const base = {
      commandType: 'CreateCustomerAccount' as const,
      tenantId: ids.tenantId,
      customerId: ids.customerId,
      accountType: 'CREDIT' as const,
      currency: 'USD',
    };
    expect(() => createCustomerAccountSchema.parse(base)).toThrow(
      'Credit accounts require a positive credit limit',
    );
    expect(() => createCustomerAccountSchema.parse({ ...base, creditLimit: '0.0000' })).toThrow(
      'Credit accounts require a positive credit limit',
    );
    expect(createCustomerAccountSchema.parse({ ...base, creditLimit: '0.0001' }).creditLimit).toBe(
      '0.0001',
    );
  });

  it('accepts an arbitrary uppercase currency code without inventing FX behavior', () => {
    const result = createCustomerAccountSchema.parse({
      commandType: 'CreateCustomerAccount',
      tenantId: ids.tenantId,
      customerId: ids.customerId,
      accountType: 'CREDIT',
      currency: 'ZWL',
      creditLimit: '1000.0000',
    });
    expect(result.currency).toBe('ZWL');
  });

  it('requires value-only or litre-only prepaid top-up shapes', () => {
    expect(() =>
      recordPrepaidTopUpSchema.parse({
        commandType: 'RecordPrepaidTopUp',
        tenantId: ids.tenantId,
        accountId: ids.accountId,
        accountType: 'PREPAID_VALUE',
        productId: ids.productId,
        amount: { amount: '10.0000', currency: 'USD' },
        source,
        occurredAt: '2026-09-23T08:00:00Z',
        businessDate: '2026-09-23',
      }),
    ).toThrow('Prepaid value top-ups require only a monetary amount');

    const result = recordPrepaidTopUpSchema.parse({
      commandType: 'RecordPrepaidTopUp',
      tenantId: ids.tenantId,
      accountId: ids.accountId,
      accountType: 'PREPAID_LITRES',
      productId: ids.productId,
      litres: '20.000',
      source,
      occurredAt: '2026-09-23T08:00:00Z',
      businessDate: '2026-09-23',
    });
    expect(result.litres).toBe('20.000');
  });

  it('accepts a monthly statement period and rejects ambiguous period bounds', () => {
    expect(
      customerStatementQuerySchema.parse({
        tenantId: ids.tenantId,
        accountId: ids.accountId,
        period: '2026-09',
      }).period,
    ).toBe('2026-09');
    expect(() =>
      customerStatementQuerySchema.parse({
        tenantId: ids.tenantId,
        accountId: ids.accountId,
        period: '2026-13',
      }),
    ).toThrow('A statement period must use YYYY-MM');
    expect(() =>
      customerStatementQuerySchema.parse({
        tenantId: ids.tenantId,
        accountId: ids.accountId,
        period: '2026-09',
        asOf: '2026-09-30T23:59:59Z',
      }),
    ).toThrow('A statement period cannot be combined with asOf');
  });
});

describe('customer station scope validation (ADR-017)', () => {
  const station = '00000000-0000-4000-8000-000000000006';
  const other = '00000000-0000-4000-8000-000000000007';
  const base = {
    commandType: 'SetCustomerAccountStations' as const,
    tenantId: ids.tenantId,
    accountId: ids.accountId,
    expectedVersion: 0,
  };

  it('requires a station list for a selected scope', () => {
    expect(
      setCustomerAccountStationsSchema.safeParse({ ...base, stationScope: 'SELECTED' }).success,
    ).toBe(false);
    expect(
      setCustomerAccountStationsSchema.safeParse({
        ...base,
        stationScope: 'SELECTED',
        stationIds: [station, other],
      }).success,
    ).toBe(true);
  });

  it('rejects listed stations for the all-stations scope and duplicate stations', () => {
    expect(
      setCustomerAccountStationsSchema.safeParse({
        ...base,
        stationScope: 'ALL',
        stationIds: [station],
      }).success,
    ).toBe(false);
    expect(
      setCustomerAccountStationsSchema.safeParse({
        ...base,
        stationScope: 'SELECTED',
        stationIds: [station, station],
      }).success,
    ).toBe(false);
  });

  it('defaults a new account to all stations and checks its station list', () => {
    const account = {
      commandType: 'CreateCustomerAccount' as const,
      tenantId: ids.tenantId,
      customerId: ids.customerId,
      accountType: 'PREPAID_VALUE' as const,
      currency: 'USD',
    };
    expect(createCustomerAccountSchema.safeParse(account).success).toBe(true);
    expect(
      createCustomerAccountSchema.safeParse({ ...account, stationScope: 'SELECTED' }).success,
    ).toBe(false);
  });

  it('needs a legal entity id to set the customer legal entity', () => {
    const command = {
      commandType: 'SetCustomerLegalEntity' as const,
      tenantId: ids.tenantId,
      customerId: ids.customerId,
      expectedVersion: 0,
    };
    expect(setCustomerLegalEntitySchema.safeParse(command).success).toBe(false);
    expect(
      setCustomerLegalEntitySchema.safeParse({ ...command, legalEntityId: station }).success,
    ).toBe(true);
  });
});

describe('customer payment receiving station (ADR-017)', () => {
  const payment = {
    commandType: 'RecordCustomerPayment' as const,
    tenantId: ids.tenantId,
    accountId: ids.accountId,
    amount: { amount: '10.0000', currency: 'USD' },
    source: { sourceType: 'CUSTOMER_PAYMENT' as const, sourceId: ids.productId },
    occurredAt: '2026-09-24T09:00:00+02:00',
    businessDate: '2026-09-24',
  };

  it('requires the station that received the cash', () => {
    expect(recordCustomerPaymentSchema.safeParse(payment).success).toBe(false);
    expect(
      recordCustomerPaymentSchema.safeParse({
        ...payment,
        receivingStationId: '00000000-0000-4000-8000-000000000006',
      }).success,
    ).toBe(true);
  });
});
