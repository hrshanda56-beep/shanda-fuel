import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';

const tenantResolver = vi.hoisted(() => vi.fn());

vi.mock('../tenancy/authority', () => ({
  resolveTenantExecutionContext: tenantResolver,
}));

import { authorizeForecourtCommandPreflight, type ForecourtCommandContext } from './application';

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  legalEntity: '22222222-2222-4222-8222-222222222222',
  station: '33333333-3333-4333-8333-333333333333',
  actor: '44444444-4444-4444-8444-444444444444',
  membership: '55555555-5555-4555-8555-555555555555',
};

function authority(roleCode: 'SUPERVISOR' | 'ATTENDANT' = 'SUPERVISOR') {
  const roleAssignment = {
    tenantId: ids.tenant,
    scopeType: 'STATION' as const,
    legalEntityId: ids.legalEntity,
    stationId: ids.station,
    roleCode,
  };
  const transaction = createTrustedTenantTransactionContext({
    tenantId: ids.tenant,
    actorId: ids.actor,
    membershipId: ids.membership,
    requestId: '66666666-6666-4666-8666-666666666666',
  });
  return {
    actor: {
      identityId: ids.actor,
      session: {
        sessionId: '77777777-7777-4777-8777-777777777777',
        userId: ids.actor,
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    },
    membership: {
      tenantId: ids.tenant,
      membershipId: ids.membership,
      identityId: ids.actor,
      actorId: ids.actor,
      status: 'ACTIVE' as const,
      roleAssignments: [roleAssignment],
      temporaryGrants: [],
    },
    authorization: {
      userId: ids.actor,
      membershipId: ids.membership,
      tenantId: ids.tenant,
      membershipActive: true,
      roleAssignments: [roleAssignment],
      temporaryGrants: [],
    },
    transaction,
  };
}

const station = {
  id: ids.station,
  tenantId: ids.tenant,
  legalEntityId: ids.legalEntity,
};

const request = new Request('https://fuel.example.test/api/forecourt/commands');

describe('forecourt command authorization preflight', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    tenantResolver.mockResolvedValue(authority());
  });

  it('rejects malformed authority selectors before loading tenant or station context', async () => {
    const loadStation = vi.fn();

    await expect(
      authorizeForecourtCommandPreflight({
        request,
        commandType: 'OpenBusinessDay',
        body: { tenantId: ids.tenant, stationId: 'not-a-uuid' },
        loadStation,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(tenantResolver).not.toHaveBeenCalled();
    expect(loadStation).not.toHaveBeenCalled();
  });

  it('establishes station authority without requiring the full command payload', async () => {
    const loadStation = vi.fn().mockResolvedValue(station);

    const context = await authorizeForecourtCommandPreflight({
      request,
      commandType: 'OpenBusinessDay',
      body: { tenantId: ids.tenant, stationId: ids.station },
      loadStation,
    });

    expect(context).toMatchObject<Partial<ForecourtCommandContext>>({
      tenantId: ids.tenant,
      stationId: ids.station,
      legalEntityId: ids.legalEntity,
    });
    expect(loadStation).toHaveBeenCalledWith(expect.anything(), ids.station);
  });

  it('returns a generic denial without permission details', async () => {
    tenantResolver.mockResolvedValue(authority('ATTENDANT'));
    const loadStation = vi.fn().mockResolvedValue(station);

    await expect(
      authorizeForecourtCommandPreflight({
        request,
        commandType: 'OpenBusinessDay',
        body: { tenantId: ids.tenant, stationId: ids.station },
        loadStation,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Forecourt command authority could not be established',
      details: undefined,
    });
  });
});
