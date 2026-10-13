import { describe, expect, it } from 'vitest';

import type { ContextResolution } from '../context';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import type { AuthorizationActor } from '../../platform/security';

import { buildSettingsView, resolveSettings } from './queries';

const ids = {
  organisation: '11111111-1111-4111-8111-111111111111',
  otherOrganisation: '22222222-2222-4222-8222-222222222222',
  legalEntity: '33333333-3333-4333-8333-333333333333',
  otherLegalEntity: '44444444-4444-4444-8444-444444444444',
  station: '55555555-5555-4555-8555-555555555555',
  otherStation: '66666666-6666-4666-8666-666666666666',
  actor: '77777777-7777-4777-8777-777777777777',
  membership: '88888888-8888-4888-8888-888888888888',
  session: '99999999-9999-4999-8999-999999999999',
};

const request = new Request('http://shanda-fuel.local/settings');

const resolution: ContextResolution = {
  available: {
    organisations: [
      {
        id: ids.organisation,
        name: 'Authorised organisation',
        legalEntities: [
          {
            id: ids.legalEntity,
            name: 'Trading entity',
            stations: [
              {
                id: ids.station,
                code: 'STA',
                name: 'Authorised station',
                timezone: 'Africa/Harare',
              },
            ],
          },
        ],
      },
    ],
  },
  current: {
    organisationId: ids.organisation,
    legalEntityId: ids.legalEntity,
    stationId: ids.station,
    allStations: false,
  },
  route: {
    pathname: '/settings',
    policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: false },
  },
  persistedContextInvalid: false,
};

const accountResponse = {
  user: { id: ids.actor, name: 'Ava Operator', email: 'ava@example.test' },
  session: { userId: ids.actor },
};

function authorityFor(authorization: AuthorizationActor) {
  return {
    authorization,
    membership: {
      tenantId: ids.organisation,
      membershipId: ids.membership,
      identityId: ids.actor,
      actorId: ids.actor,
      status: 'ACTIVE' as const,
      roleAssignments: authorization.roleAssignments,
      temporaryGrants: [],
    },
    actor: {
      identityId: ids.actor,
      session: {
        sessionId: ids.session,
        userId: ids.actor,
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    },
    transaction: createTrustedTenantTransactionContext({
      tenantId: ids.organisation,
      actorId: ids.actor,
      membershipId: ids.membership,
    }),
  };
}

const financeAuthorization: AuthorizationActor = {
  userId: ids.actor,
  membershipId: ids.membership,
  tenantId: ids.organisation,
  membershipActive: true,
  roleAssignments: [
    {
      tenantId: ids.organisation,
      scopeType: 'TENANT',
      roleCode: 'FINANCE',
    },
  ],
  temporaryGrants: [],
};

const stationOnlyAuthorization: AuthorizationActor = {
  ...financeAuthorization,
  roleAssignments: [
    {
      tenantId: ids.organisation,
      scopeType: 'STATION',
      legalEntityId: ids.legalEntity,
      stationId: ids.station,
      roleCode: 'SUPERVISOR',
    },
  ],
};

function dependencies(
  currentResolution: ContextResolution = resolution,
  authorization: AuthorizationActor = financeAuthorization,
) {
  return {
    readSession: async () => accountResponse,
    resolveContext: async () => currentResolution,
    resolveAuthority: async () => authorityFor(authorization),
  };
}

describe('Settings read model', () => {
  it('returns the real account and authorised organisation hierarchy', async () => {
    const view = await resolveSettings(request, dependencies());

    expect(view.account).toEqual({ name: 'Ava Operator', email: 'ava@example.test' });
    expect(view.context.organisation).toEqual({
      id: ids.organisation,
      name: 'Authorised organisation',
    });
    expect(view.context.legalEntities).toEqual([{ id: ids.legalEntity, name: 'Trading entity' }]);
    expect(view.context.selectedStation).toEqual({
      id: ids.station,
      code: 'STA',
      name: 'Authorised station',
      timezone: 'Africa/Harare',
    });
  });

  it('rejects an unauthenticated account response', async () => {
    await expect(
      resolveSettings(request, { ...dependencies(), readSession: async () => null }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('preserves a nullable email for Staff Number identities', async () => {
    await expect(
      resolveSettings(request, {
        ...dependencies(),
        readSession: async () => ({
          user: { id: ids.actor, name: 'Ava Operator', email: null },
          session: { userId: ids.actor },
        }),
      }),
    ).resolves.toMatchObject({ account: { name: 'Ava Operator', email: null } });
  });

  it('rejects an actor without organisation-view permission', async () => {
    await expect(
      resolveSettings(request, dependencies(resolution, stationOnlyAuthorization)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps an authenticated account available when no authorised work context exists', async () => {
    const noContext: ContextResolution = {
      ...resolution,
      available: { organisations: [] },
      current: null,
    };

    await expect(resolveSettings(request, dependencies(noContext))).resolves.toMatchObject({
      account: { email: 'ava@example.test' },
      context: { status: 'unavailable', selectedStation: null },
    });
  });

  it('rejects a current organisation that is absent from authorised Context', () => {
    expect(() =>
      buildSettingsView(
        { name: 'Ava Operator', email: 'ava@example.test' },
        {
          ...resolution,
          current: { ...resolution.current!, organisationId: ids.otherOrganisation },
        },
      ),
    ).toThrow('organisation');
  });

  it('rejects a station selected outside its authorised legal entity', () => {
    expect(() =>
      buildSettingsView(
        { name: 'Ava Operator', email: 'ava@example.test' },
        {
          ...resolution,
          available: {
            organisations: [
              {
                ...resolution.available.organisations[0]!,
                legalEntities: [
                  {
                    id: ids.legalEntity,
                    name: 'Trading entity',
                    stations: [],
                  },
                  {
                    id: ids.otherLegalEntity,
                    name: 'Other entity',
                    stations: [
                      {
                        id: ids.otherStation,
                        code: 'OTHER',
                        name: 'Other station',
                        timezone: 'Africa/Harare',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          current: {
            organisationId: ids.organisation,
            legalEntityId: ids.legalEntity,
            stationId: ids.otherStation,
            allStations: false,
          },
        },
      ),
    ).toThrow('legal entity');
  });
});
