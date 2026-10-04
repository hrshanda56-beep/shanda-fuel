import { describe, expect, it } from 'vitest';

import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import type { AuthorizationActor } from '../../platform/security';
import { filterAuthorizedContextRows, type AuthorizedContextRow } from './queries';

const ids = {
  tenantA: '11111111-1111-4111-8111-111111111111',
  tenantB: '22222222-2222-4222-8222-222222222222',
  legalA: '33333333-3333-4333-8333-333333333333',
  legalB: '44444444-4444-4444-8444-444444444444',
  stationA: '55555555-5555-4555-8555-555555555555',
  stationB: '66666666-6666-4666-8666-666666666666',
  actor: '77777777-7777-4777-8777-777777777777',
  membership: '88888888-8888-4888-8888-888888888888',
};

const authorization: AuthorizationActor = {
  userId: ids.actor,
  membershipId: ids.membership,
  tenantId: ids.tenantA,
  membershipActive: true,
  roleAssignments: [
    {
      tenantId: ids.tenantA,
      scopeType: 'STATION',
      legalEntityId: ids.legalA,
      stationId: ids.stationA,
      roleCode: 'SUPERVISOR',
    },
  ],
  temporaryGrants: [],
};

const authority = {
  authorization,
  membership: {
    tenantId: ids.tenantA,
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
      sessionId: '99999999-9999-4999-8999-999999999999',
      userId: ids.actor,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    },
  },
  transaction: createTrustedTenantTransactionContext({
    tenantId: ids.tenantA,
    actorId: ids.actor,
    membershipId: ids.membership,
  }),
};

const rows: AuthorizedContextRow[] = [
  {
    organisation_id: ids.tenantA,
    organisation_name: 'Tenant A',
    legal_entity_id: ids.legalA,
    legal_entity_name: 'Tenant A Legal',
    station_id: ids.stationA,
    station_code: 'A',
    station_name: 'Authorised station',
    station_timezone: 'Africa/Harare',
  },
  {
    organisation_id: ids.tenantA,
    organisation_name: 'Tenant A',
    legal_entity_id: ids.legalB,
    legal_entity_name: 'Tenant A Other Legal',
    station_id: ids.stationB,
    station_code: 'B',
    station_name: 'Unauthorised station',
    station_timezone: 'Africa/Harare',
  },
  {
    organisation_id: ids.tenantB,
    organisation_name: 'Tenant B',
    legal_entity_id: ids.legalB,
    legal_entity_name: 'Tenant B Legal',
    station_id: ids.stationB,
    station_code: 'B2',
    station_name: 'Cross-tenant station',
    station_timezone: 'Africa/Harare',
  },
];

describe('authorised context discovery filtering', () => {
  it('returns the authorised station only and never crosses tenant boundaries', () => {
    const available = filterAuthorizedContextRows(authority, rows);
    expect(available.organisations.map((organisation) => organisation.id)).toEqual([ids.tenantA]);
    expect(available.organisations[0]?.legalEntities).toEqual([
      expect.objectContaining({
        id: ids.legalA,
        stations: [expect.objectContaining({ id: ids.stationA, name: 'Authorised station' })],
      }),
    ]);
    expect(JSON.stringify(available)).not.toContain('Unauthorised station');
    expect(JSON.stringify(available)).not.toContain('Cross-tenant station');
  });
});
