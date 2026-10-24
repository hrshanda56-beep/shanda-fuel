import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the 0029 Staff Number RLS integration test.');
}

const ids = {
  tenant: '02900000-0000-4000-8000-000000000001',
  otherTenant: '02900000-0000-4000-8000-000000000002',
  legalEntity: '02900000-0000-4000-8000-000000000011',
  station: '02900000-0000-4000-8000-000000000021',
  owner: '02900000-0000-4000-8000-000000000031',
  otherOwner: '02900000-0000-4000-8000-000000000032',
  newUser: '02900000-0000-4000-8000-000000000033',
  ownerMembership: '02900000-0000-4000-8000-000000000041',
  otherOwnerMembership: '02900000-0000-4000-8000-000000000042',
  invitation: '02900000-0000-4000-8000-000000000061',
};

const activationHash = 'c'.repeat(64);

// Only `unsafe` is used, and callers pass a transaction handle as well as the client.
async function expectPgError(
  transaction: Pick<Sql, 'unsafe'>,
  name: string,
  action: () => Promise<unknown>,
  code: string,
  message: string,
) {
  await transaction.unsafe(`savepoint ${name}`);
  try {
    await action();
    throw new Error(`Expected PostgreSQL ${code} from ${name}`);
  } catch (error) {
    if (error instanceof Error && error.message === `Expected PostgreSQL ${code} from ${name}`) {
      throw error;
    }
    const postgresError = error as { code?: string; message?: string };
    expect(postgresError.code, name).toBe(code);
    expect(postgresError.message, name).toContain(message);
  } finally {
    await transaction.unsafe(`rollback to savepoint ${name}`);
  }
}

describe('0029 Staff Number registry RLS capability boundary', () => {
  let client: Sql;

  beforeAll(() => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await client?.end();
  });

  it('keeps app_runtime least-privilege while allowing one tenant-safe activation', async () => {
    const rollback = new Error('rollback disposable 0029 capability proof');

    await expect(
      client.begin(async (transaction) => {
        await transaction.unsafe(`
          insert into app.tenants (id, name, slug, status) values
            ('${ids.tenant}', '0029 Tenant One', '0029-tenant-one', 'ACTIVE'),
            ('${ids.otherTenant}', '0029 Tenant Two', '0029-tenant-two', 'ACTIVE');
          insert into app.legal_entities (id, tenant_id, legal_name, status)
            values ('${ids.legalEntity}', '${ids.tenant}', '0029 Legal Entity', 'ACTIVE');
          insert into app.stations (id, tenant_id, legal_entity_id, code, name, timezone, status)
            values ('${ids.station}', '${ids.tenant}', '${ids.legalEntity}', '0029', '0029 Station', 'Africa/Harare', 'ACTIVE');
          insert into app.users (id, name, email, email_verified) values
            ('${ids.owner}', '0029 Owner', '0029-owner@example.test', true),
            ('${ids.otherOwner}', '0029 Other Owner', '0029-other-owner@example.test', true),
            ('${ids.newUser}', '0029 New User', '0029-new-user@example.test', false);
          insert into app.memberships (id, tenant_id, identity_id, status) values
            ('${ids.ownerMembership}', '${ids.tenant}', '${ids.owner}', 'ACTIVE'),
            ('${ids.otherOwnerMembership}', '${ids.otherTenant}', '${ids.otherOwner}', 'ACTIVE');
          insert into app.membership_role_assignments
            (tenant_id, membership_id, role_code, scope_type)
          values
            ('${ids.tenant}', '${ids.ownerMembership}', 'OWNER', 'TENANT'),
            ('${ids.otherTenant}', '${ids.otherOwnerMembership}', 'OWNER', 'TENANT');
          insert into app.staff_invitations
            (id, tenant_id, invited_email, invited_name, assigned_role, scope_type,
             legal_entity_id, token_hash, status, expires_at, created_by_user_id,
             created_by_membership_id, delivery_method)
          values
            ('${ids.invitation}', '${ids.tenant}', null, '0029 New User', 'ATTENDANT', 'STATION',
             '${ids.legalEntity}', '${activationHash}', 'PENDING', now() + interval '1 day',
             '${ids.owner}', '${ids.ownerMembership}', 'EMAIL');
        `);

        await transaction.unsafe('set local role app_runtime');
        await transaction.unsafe(`
          select
            set_config('app.tenant_id', '${ids.tenant}', false),
            set_config('app.actor_id', '${ids.owner}', false),
            set_config('app.membership_id', '${ids.ownerMembership}', false)
        `);

        await expectPgError(
          transaction,
          'staff_number_direct_select',
          () => transaction.unsafe('select * from app.staff_number_registry'),
          '42501',
          'permission denied for table staff_number_registry',
        );

        const reserved = await transaction<{ id: string }[]>`
          select app.reserve_staff_number(${ids.invitation}::uuid, 'SF-02900001') as id
        `;
        expect(reserved).toHaveLength(1);

        await expectPgError(
          transaction,
          'staff_number_duplicate_reserve',
          () =>
            transaction.unsafe(
              `select app.reserve_staff_number('${ids.invitation}', 'SF-02900001')`,
            ),
          '23505',
          'That staff number is already in use',
        );

        await transaction.unsafe('reset role');
        await transaction.unsafe(`
          update app.staff_invitations
          set delivery_method = 'MANUAL',
              staff_number_registry_id = (
                select id from app.staff_number_registry
                where reserved_invitation_id = '${ids.invitation}'
              )
          where id = '${ids.invitation}';
          insert into app.staff_invitation_stations
            (tenant_id, invitation_id, legal_entity_id, station_id)
          values ('${ids.tenant}', '${ids.invitation}', '${ids.legalEntity}', '${ids.station}');
        `);
        await transaction.unsafe('set local role app_runtime');

        const resolved = await transaction<{ staff_number: string }[]>`
          select * from app.resolve_manual_staff_invitation(${activationHash}, 'SF-02900001')
        `;
        expect(resolved[0]?.staff_number).toBe('SF-02900001');

        const accepted = await transaction<{ membership_id: string; tenant_id: string }[]>`
          select * from app.accept_manual_staff_invitation(
            ${activationHash}, ${ids.newUser}::uuid, 'synthetic-0029-provider-user',
            '02900000-0000-4000-8000-000000000091'::uuid
          )
        `;
        expect(accepted).toHaveLength(1);
        expect(accepted[0]?.tenant_id).toBe(ids.tenant);

        await expectPgError(
          transaction,
          'staff_number_replay',
          () =>
            transaction.unsafe(`
            select * from app.accept_manual_staff_invitation(
              '${activationHash}', '${ids.newUser}', 'synthetic-0029-replay',
              '02900000-0000-4000-8000-000000000092'
            )
          `),
          'P0001',
          'manual invitation unavailable',
        );

        await transaction.unsafe(`
          select set_config('app.tenant_id', '${ids.otherTenant}', false),
                 set_config('app.actor_id', '${ids.otherOwner}', false),
                 set_config('app.membership_id', '${ids.otherOwnerMembership}', false)
        `);
        const crossTenant = await transaction<{ staff_number: string }[]>`
          select * from app.resolve_staff_number_for_user(${ids.newUser}::uuid)
        `;
        expect(crossTenant).toEqual([]);

        await transaction.unsafe('reset role');
        const state = await transaction<
          {
            registry_status: string;
            internal_user_id: string | null;
            invitation_status: string;
            direct_select: boolean;
            direct_insert: boolean;
            direct_update: boolean;
          }[]
        >`
          select
            registry.status as registry_status,
            registry.internal_user_id,
            invitation.status as invitation_status,
            has_table_privilege('app_runtime', 'app.staff_number_registry', 'SELECT') as direct_select,
            has_table_privilege('app_runtime', 'app.staff_number_registry', 'INSERT') as direct_insert,
            has_table_privilege('app_runtime', 'app.staff_number_registry', 'UPDATE') as direct_update
          from app.staff_number_registry registry
          join app.staff_invitations invitation on invitation.id = ${ids.invitation}::uuid
          where registry.normalized_staff_number = 'SF-02900001'
        `;
        expect(state).toEqual([
          {
            registry_status: 'ASSIGNED',
            internal_user_id: ids.newUser,
            invitation_status: 'ACCEPTED',
            direct_select: false,
            direct_insert: false,
            direct_update: false,
          },
        ]);

        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
