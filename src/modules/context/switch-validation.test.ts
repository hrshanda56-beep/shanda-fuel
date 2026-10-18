import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), execute: vi.fn(), database: vi.fn() }));
vi.mock('../tenancy/server', () => ({
  resolveTenantExecutionContext: mocks.resolve,
  loadTenantMembership: vi.fn(),
}));
vi.mock('../../platform/db', () => ({ getDatabase: mocks.database }));
vi.mock('../../platform/db/transaction', () => ({
  withTenantTransaction: async (_: unknown, work: (tx: unknown) => unknown) =>
    work({ execute: mocks.execute }),
}));
import { validateRequestedContext } from './queries';
const tenant = '11111111-1111-4111-8111-111111111111',
  entity = '22222222-2222-4222-8222-222222222222',
  station = '33333333-3333-4333-8333-333333333333';
it('checks the supplied tenant directly without full membership discovery', async () => {
  mocks.resolve.mockResolvedValue({
    membership: { tenantId: tenant },
    transaction: {},
    authorization: {
      tenantId: tenant,
      membershipActive: true,
      roleAssignments: [{ tenantId: tenant, scopeType: 'TENANT', roleCode: 'OWNER' }],
      temporaryGrants: [],
    },
  });
  mocks.execute.mockResolvedValue([
    {
      organisation_id: tenant,
      organisation_name: 'Company',
      legal_entity_id: entity,
      legal_entity_name: 'Entity',
      station_id: station,
      station_code: 'S',
      station_name: 'Station',
      station_timezone: 'Africa/Harare',
    },
  ]);
  const selection = {
    organisationId: tenant,
    legalEntityId: entity,
    stationId: station,
    allStations: false,
  };
  expect(
    await validateRequestedContext(new Request('http://localhost/api/context'), selection, {
      pathname: '/',
    }),
  ).toEqual(selection);
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(mocks.database).not.toHaveBeenCalled();
  const all = { organisationId: tenant, allStations: true };
  expect(
    await validateRequestedContext(new Request('http://localhost/api/context'), all, {
      pathname: '/cash',
    }),
  ).toEqual(all);
  await expect(
    validateRequestedContext(new Request('http://localhost/api/context'), all, {
      pathname: `/stations/${station}/cash`,
    }),
  ).rejects.toThrow();
  mocks.execute.mockResolvedValue([]);
  await expect(
    validateRequestedContext(new Request('http://localhost/api/context'), selection, {
      pathname: '/',
    }),
  ).rejects.toThrow();
});
