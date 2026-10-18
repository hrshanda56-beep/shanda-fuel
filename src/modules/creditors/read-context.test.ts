import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), transaction: vi.fn() }));
vi.mock('../context/read-authority', () => ({ resolveTenantReadAuthority: mocks.read }));
vi.mock('../../platform/db/transaction', () => ({ withTenantTransaction: mocks.transaction }));
import { resolveSupplierReadContext } from './read-context';
const tenantId = '11111111-1111-4111-8111-111111111111',
  actorId = '22222222-2222-4222-8222-222222222222',
  membershipId = '33333333-3333-4333-8333-333333333333',
  legalEntityId = '44444444-4444-4444-8444-444444444444';
const authority = { transaction: { tenantId, actorId, membershipId } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ authority, rows: [{ legal_entity_id: legalEntityId }] });
});
it('uses persisted active legal-entity metadata without a discovery transaction', async () => {
  const context = await resolveSupplierReadContext({
    request: new Request('http://localhost'),
    requestedTenantId: tenantId,
    legalEntityId,
  });
  expect(context.scope).toEqual({ tenantId, scopeType: 'LEGAL_ENTITY', legalEntityId });
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it('retains the scoped database lookup and not-found error for an absent entity', async () => {
  mocks.read.mockResolvedValue({ authority, rows: [] });
  mocks.transaction.mockResolvedValue([]);
  await expect(
    resolveSupplierReadContext({
      request: new Request('http://localhost'),
      requestedTenantId: tenantId,
      legalEntityId,
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
});
