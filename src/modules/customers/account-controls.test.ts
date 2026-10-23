import { describe, expect, it } from 'vitest';
import { CUSTOMER_COMMAND_POLICY, CUSTOMER_COMMAND_TYPES } from './application';
import {
  customerEntryDetailsSchema,
  overrideCustomerCreditLimitSchema,
  recordCustomerEntryDetailsSchema,
  recordCustomerPaymentSchema,
} from './validation';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('customer entry details (vehicle, driver, voucher, approver, document)', () => {
  it('accepts any one field and upper-cases the vehicle registration', () => {
    const parsed = customerEntryDetailsSchema.parse({ vehicleRegistration: ' abc 1234 ' });
    expect(parsed.vehicleRegistration).toBe('ABC 1234');
    expect(customerEntryDetailsSchema.safeParse({ voucherNumber: 'V-001' }).success).toBe(true);
    expect(customerEntryDetailsSchema.safeParse({ driverName: 'T. Moyo' }).success).toBe(true);
  });

  it('rejects an empty object, blank text and unknown fields', () => {
    expect(customerEntryDetailsSchema.safeParse({}).success).toBe(false);
    expect(customerEntryDetailsSchema.safeParse({ driverName: '   ' }).success).toBe(false);
    expect(customerEntryDetailsSchema.safeParse({ voucherNumber: 'x', extra: 1 }).success).toBe(
      false,
    );
  });

  it('enforces length limits and uuid ids', () => {
    expect(
      customerEntryDetailsSchema.safeParse({ vehicleRegistration: 'A'.repeat(21) }).success,
    ).toBe(false);
    expect(customerEntryDetailsSchema.safeParse({ approvedByMembershipId: 'nope' }).success).toBe(
      false,
    );
    expect(
      customerEntryDetailsSchema.safeParse({
        approvedByMembershipId: uuid(1),
        documentId: uuid(2),
      }).success,
    ).toBe(true);
  });

  it('does not require voucher numbers to be unique (open owner decision)', () => {
    const body = {
      commandType: 'RecordCustomerEntryDetails',
      tenantId: uuid(1),
      stationId: uuid(2),
      ledgerEntryId: uuid(3),
      details: { voucherNumber: 'SAME-1' },
    };
    expect(recordCustomerEntryDetailsSchema.safeParse(body).success).toBe(true);
    expect(
      recordCustomerEntryDetailsSchema.safeParse({ ...body, ledgerEntryId: uuid(4) }).success,
    ).toBe(true);
  });

  it('is an optional part of recording a payment', () => {
    const payment = {
      commandType: 'RecordCustomerPayment',
      tenantId: uuid(1),
      accountId: uuid(2),
      receivingStationId: uuid(3),
      amount: { amount: '10.0000', currency: 'USD' },
      source: { sourceType: 'CUSTOMER_PAYMENT', sourceId: uuid(4) },
      occurredAt: '2026-10-23T08:00:00Z',
      businessDate: '2026-10-23',
    };
    expect(recordCustomerPaymentSchema.safeParse(payment).success).toBe(true);
    expect(
      recordCustomerPaymentSchema.safeParse({
        ...payment,
        entryDetails: { voucherNumber: 'R-9', driverName: 'T. Moyo' },
      }).success,
    ).toBe(true);
  });
});

describe('credit limit override', () => {
  const base = {
    commandType: 'OverrideCustomerCreditLimit',
    tenantId: uuid(1),
    accountId: uuid(2),
    expectedVersion: 3,
    newLimit: '5000.0000',
    approvedByMembershipId: uuid(3),
    reason: 'Long-standing customer, owner agreed by phone',
  };

  it('needs an approver and a reason', () => {
    expect(overrideCustomerCreditLimitSchema.safeParse(base).success).toBe(true);
    expect(overrideCustomerCreditLimitSchema.safeParse({ ...base, reason: '  ' }).success).toBe(
      false,
    );
    const { approvedByMembershipId: _omit, ...withoutApprover } = base;
    expect(overrideCustomerCreditLimitSchema.safeParse(withoutApprover).success).toBe(false);
  });

  it('keeps the limit as exact text and rejects zero', () => {
    expect(overrideCustomerCreditLimitSchema.parse(base).newLimit).toBe('5000.0000');
    expect(
      overrideCustomerCreditLimitSchema.safeParse({ ...base, newLimit: '0.0000' }).success,
    ).toBe(false);
    expect(overrideCustomerCreditLimitSchema.safeParse({ ...base, newLimit: '-5' }).success).toBe(
      false,
    );
  });

  it('is gated by the existing customer.limit.override permission with a fresh check', () => {
    expect(CUSTOMER_COMMAND_TYPES).toContain('OverrideCustomerCreditLimit');
    expect(CUSTOMER_COMMAND_POLICY.OverrideCustomerCreditLimit).toMatchObject({
      permissionCode: 'customer.limit.override',
      requiresStepUp: true,
    });
    expect(CUSTOMER_COMMAND_POLICY.RecordCustomerEntryDetails?.permissionCode).toBe(
      'customer.credit.authorize',
    );
  });
});
