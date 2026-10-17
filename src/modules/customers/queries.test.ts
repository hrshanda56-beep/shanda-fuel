import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  execute: vi.fn(),
  resolveContext: vi.fn(),
  withTenantTransaction: vi.fn(),
}));

vi.mock('./application', () => ({
  authorizeCustomerCommand: mocks.authorize,
  resolveCustomerCommandContext: mocks.resolveContext,
}));

vi.mock('./persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./persistence')>()),
  loadAccount: vi.fn(),
}));

vi.mock('../../platform/db/transaction', () => ({
  withTenantTransaction: mocks.withTenantTransaction,
}));

import { getCustomerAccountStatementFromRequest, getCustomerAccountsFromRequest } from './queries';

const tenantId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const creditAccountId = '33333333-3333-4333-8333-333333333333';
const litreAccountId = '44444444-4444-4444-8444-444444444444';
const productId = '55555555-5555-4555-8555-555555555555';

describe('customer read-only summary projection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveContext.mockResolvedValue({
      tenantId,
      authority: { transaction: { tenantId, actorId: 'actor', membershipId: 'membership' } },
    });
    mocks.withTenantTransaction.mockImplementation(async (_context, work) =>
      work({ execute: mocks.execute }),
    );
  });

  it('derives exact monetary and litre availability without binary arithmetic', async () => {
    mocks.execute
      .mockResolvedValueOnce([
        {
          customer_id: customerId,
          account_reference: 'CUST-001',
          display_name: 'Bindura Transport',
          customer_status: 'ACTIVE',
          customer_version: 2,
          contact_metadata: { phone: '+263 77 000 0000', ignored: 42 },
          account_id: creditAccountId,
          account_type: 'CREDIT',
          account_status: 'ACTIVE',
          account_version: 3,
          currency: 'USD',
          credit_limit: '20.0000',
          balance: '8.0050',
          reserved_amount: '1.2500',
          available_balance: null,
          available_credit: '10.7450',
          monetary_exposure: '8.0050',
        },
        {
          customer_id: customerId,
          account_reference: 'CUST-001',
          display_name: 'Bindura Transport',
          customer_status: 'ACTIVE',
          customer_version: 2,
          contact_metadata: { phone: '+263 77 000 0000' },
          account_id: litreAccountId,
          account_type: 'PREPAID_LITRES',
          account_status: 'ACTIVE',
          account_version: 1,
          currency: 'USD',
          credit_limit: null,
          balance: null,
          reserved_amount: null,
          available_balance: null,
          available_credit: null,
          monetary_exposure: '8.0050',
        },
      ])
      .mockResolvedValueOnce([
        {
          account_id: litreAccountId,
          product_id: productId,
          product_code: 'DIESEL',
          product_name: 'Diesel',
          balance_litres: '89.875',
          reserved_litres: '5.125',
          available_litres: '84.750',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '66666666-6666-4666-8666-666666666666',
          account_id: creditAccountId,
          account_type: 'CREDIT',
          entry_type: 'CUSTOMER_PAYMENT',
          direction: 'DECREASE',
          occurred_at: '2026-10-17T06:00:00.000Z',
          business_date: '2026-10-17',
          amount: '2.5000',
          currency: 'USD',
          quantity_litres: null,
          product_id: null,
          product_code: null,
          product_name: null,
          note: 'Receipt 001',
        },
      ]);

    const result = await getCustomerAccountsFromRequest(
      new Request('https://fuel.example.test/api/customers/summary'),
      { tenantId, customerId },
    );

    expect(mocks.resolveContext).toHaveBeenCalledWith({
      request: expect.any(Request),
      requestedTenantId: tenantId,
    });
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), 'customer.view');
    expect(result.customers).toHaveLength(1);
    const customer = result.customers[0];
    if (!customer) throw new Error('Expected one customer');
    expect(customer).toMatchObject({
      customerId,
      contactMetadata: { phone: '+263 77 000 0000' },
    });
    expect(customer.accounts).toEqual([
      expect.objectContaining({
        accountId: creditAccountId,
        balance: '8.0050',
        reservedAmount: '1.2500',
        availableCredit: '10.7450',
      }),
      expect.objectContaining({
        accountId: litreAccountId,
        balance: null,
        productBalances: [
          expect.objectContaining({
            balanceLitres: '89.875',
            availableLitres: '84.750',
          }),
        ],
      }),
    ]);
    expect(customer.recentTransactions[0]).toMatchObject({
      amount: '2.5000',
      occurredAt: '2026-10-17T06:00:00.000Z',
    });
  });

  it('returns a customer with no accounts without inventing a balance', async () => {
    mocks.execute.mockResolvedValueOnce([
      {
        customer_id: customerId,
        account_reference: 'CUST-001',
        display_name: 'No Account Customer',
        customer_status: 'SUSPENDED',
        customer_version: '0',
        contact_metadata: null,
        account_id: null,
        account_type: null,
        account_status: null,
        account_version: null,
        currency: null,
        credit_limit: null,
        balance: null,
        reserved_amount: null,
      },
    ]);

    const result = await getCustomerAccountsFromRequest(
      new Request('https://fuel.example.test/api/customers/summary'),
      { tenantId },
    );

    expect(result).toEqual({
      customers: [
        expect.objectContaining({
          customerId,
          status: 'SUSPENDED',
          contactMetadata: {},
          accounts: [],
          recentTransactions: [],
        }),
      ],
    });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('keeps statement filtering, balance, running balance, and pagination in the database query', async () => {
    const accountId = creditAccountId;
    const entryId = '66666666-6666-4666-8666-666666666666';
    mocks.execute
      .mockResolvedValueOnce([
        {
          id: accountId,
          tenant_id: tenantId,
          customer_id: customerId,
          account_type: 'CREDIT',
          currency: 'USD',
          credit_limit: '20.0000',
          status: 'ACTIVE',
        },
      ])
      .mockResolvedValueOnce([
        {
          account_type: 'CREDIT',
          product_id: null,
          balance_amount: '5.1250',
          balance_litres: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: entryId,
          tenant_id: tenantId,
          customer_id: customerId,
          account_id: accountId,
          account_type: 'CREDIT',
          entry_type: 'CREDIT_FUEL_CHARGE',
          direction: 'INCREASE',
          amount: '5.1250',
          product_id: null,
          quantity_litres: null,
          source_type: 'A5_RECONCILIATION_CUSTOMER_FUEL',
          source_id: '77777777-7777-4777-8777-777777777777',
          source_revision_id: null,
          occurred_at: '2026-10-17T06:00:00.000Z',
          business_date: '2026-10-17',
          note: 'Fuel charge',
          reason: null,
          fuel_allocation_id: null,
          reversal_of_entry_id: null,
          running_amount: '5.1250',
          running_product_balances: null,
        },
      ]);

    const result = await getCustomerAccountStatementFromRequest(
      new Request('https://fuel.example.test/api/customers/statement'),
      { tenantId, accountId, limit: 50 },
    );

    expect(result.balance).toMatchObject({ accountType: 'CREDIT' });
    expect('amount' in result.balance ? result.balance.amount.amount.toString() : null).toBe(
      '5.125',
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.runningBalance).toMatchObject({ accountType: 'CREDIT' });
    expect(
      result.lines[0] && 'amount' in result.lines[0].runningBalance
        ? result.lines[0].runningBalance.amount.amount.toString()
        : null,
    ).toBe('5.125');
  });
});
