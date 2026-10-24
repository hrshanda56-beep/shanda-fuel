import { describe, expect, it } from 'vitest';
import { decodeNavigationMembership } from './navigation-snapshot';
const actor = '11111111-1111-4111-8111-111111111111';
const tenant = '22222222-2222-4222-8222-222222222222';
const row = {
  tenant_id: tenant,
  membership_id: '33333333-3333-4333-8333-333333333333',
  identity_id: actor,
  roles: [],
  grants: [],
  context_rows: [],
};
describe('navigation authority snapshot', () => {
  it('decodes active authority for the verified actor', () => {
    expect(decodeNavigationMembership(row, actor)).toMatchObject({
      identityId: actor,
      tenantId: tenant,
      status: 'ACTIVE',
    });
  });
  it('rejects a snapshot belonging to a different identity', () => {
    expect(() => decodeNavigationMembership(row, tenant)).toThrow();
  });
  it('rejects cross-tenant permission rows', () => {
    expect(() =>
      decodeNavigationMembership(
        {
          ...row,
          roles: [
            {
              tenant_id: actor,
              role_code: 'OWNER',
              scope_type: 'TENANT',
              legal_entity_id: null,
              station_id: null,
              expires_at: null,
            },
          ],
        },
        actor,
      ),
    ).toThrow();
  });
});

it('rejects malformed expiry instead of constructing invalid authority dates', () => {
  expect(() =>
    decodeNavigationMembership(
      {
        ...row,
        roles: [
          {
            tenant_id: tenant,
            membership_id: row.membership_id,
            role_code: 'SUPERVISOR',
            scope_type: 'TENANT',
            legal_entity_id: null,
            station_id: null,
            expires_at: 'not-a-date',
          },
        ],
      },
      actor,
    ),
  ).toThrow();
});
it('rejects permission rows bound to another membership in the same tenant', () => {
  expect(() =>
    decodeNavigationMembership(
      {
        ...row,
        roles: [
          {
            tenant_id: tenant,
            membership_id: actor,
            role_code: 'SUPERVISOR',
            scope_type: 'TENANT',
            legal_entity_id: null,
            station_id: null,
            expires_at: null,
          },
        ],
      },
      actor,
    ),
  ).toThrow('Invalid navigation authority binding');
});
