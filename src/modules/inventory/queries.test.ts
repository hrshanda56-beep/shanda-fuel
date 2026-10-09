import { beforeEach, describe, expect, it, vi } from 'vitest';

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  legal: '22222222-2222-4222-8222-222222222222',
  station: '33333333-3333-4333-8333-333333333333',
  product: '44444444-4444-4444-8444-444444444444',
  actor: '55555555-5555-4555-8555-555555555555',
  membership: '66666666-6666-4666-8666-666666666666',
};

let roleCode: 'ATTENDANT' | 'SUPERVISOR' = 'SUPERVISOR';
const stock = vi.fn();

vi.mock('./application', () => ({
  resolveInventoryCommandContext: async () => {
    const roleAssignments = [
      {
        tenantId: ids.tenant,
        scopeType: 'STATION' as const,
        legalEntityId: ids.legal,
        stationId: ids.station,
        roleCode,
      },
    ];
    return {
      scope: {
        scopeType: 'STATION' as const,
        tenantId: ids.tenant,
        legalEntityId: ids.legal,
        stationId: ids.station,
      },
      authority: {
        authorization: {
          userId: ids.actor,
          membershipId: ids.membership,
          tenantId: ids.tenant,
          membershipActive: true,
          strongAuthenticationVerified: true,
          roleAssignments,
          temporaryGrants: [],
        },
      },
    };
  },
}));

vi.mock('./persistence', () => ({
  getStationProductStock: (...args: unknown[]) => stock(...args),
  getTankVariance: vi.fn(),
}));

import { queryInventoryStock } from './queries';

const input = () => ({
  request: new Request('http://shanda-fuel.local/api/inventory/stock'),
  tenantId: ids.tenant,
  stationId: ids.station,
  productId: ids.product,
});

describe('queryInventoryStock authorization', () => {
  beforeEach(() => {
    stock.mockReset();
    stock.mockResolvedValue([{ productId: ids.product }]);
  });

  it('refuses an attendant, who lacks inventory.view, before reading stock', async () => {
    roleCode = 'ATTENDANT';
    await expect(queryInventoryStock(input())).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: { permissionCode: 'inventory.view' },
    });
    expect(stock).not.toHaveBeenCalled();
  });

  it('lets a supervisor read stock at the station', async () => {
    roleCode = 'SUPERVISOR';
    await expect(queryInventoryStock(input())).resolves.toEqual([{ productId: ids.product }]);
    expect(stock).toHaveBeenCalledTimes(1);
  });
});
