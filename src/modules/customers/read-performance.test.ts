import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ context: vi.fn(), execute: vi.fn(), transaction: vi.fn() }));
vi.mock('./read-context', () => ({ resolveCustomerReadContext: mocks.context }));
vi.mock('../../platform/db/transaction', () => ({ withTenantTransaction: mocks.transaction }));
import { getCustomerAccountsFromRequest } from './queries';
const tenantId = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({
    tenantId,
    scope: { tenantId, scopeType: 'TENANT' },
    authority: {
      transaction: {},
      authorization: {
        userId: 'actor',
        membershipId: 'member',
        tenantId,
        membershipActive: true,
        roleAssignments: [{ tenantId, roleCode: 'OWNER', scopeType: 'TENANT' }],
        temporaryGrants: [],
      },
    },
  });
  mocks.transaction.mockImplementation(async (_context, work) => work({ execute: mocks.execute }));
});
it('loads account, product, station and history sections in one data exchange', async () => {
  mocks.execute.mockResolvedValue([
    { rows: [], products: [], stationRows: [], transactionRows: [] },
  ]);
  expect(
    await getCustomerAccountsFromRequest(new Request('http://localhost'), { tenantId }),
  ).toEqual({ customers: [], fuelProducts: [] });
  expect(mocks.execute).toHaveBeenCalledTimes(1);
});
it('does not turn a missing database snapshot into empty financial data', async () => {
  mocks.execute.mockResolvedValue([]);
  await expect(
    getCustomerAccountsFromRequest(new Request('http://localhost'), { tenantId }),
  ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
});
