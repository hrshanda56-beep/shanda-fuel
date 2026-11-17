import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Removing a deactivated staff member (migration 0102). Runs as `app_runtime`, which has no DELETE
 * right on memberships, so the narrow function is the only way in. Someone with no records is
 * erased; someone referenced by other records is hidden instead and their history stays.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the staff removal test.');

const T = 'b5740000-0000-4000-8000-0000000000';
const id = (n: number) => `${T}${String(n).padStart(2, '0')}`;
const ids = {
  tenant: id(1),
  otherTenant: id(2),
  legal: id(3),
  // users 10.., memberships 20.. (same order)
  owner: 10,
  supervisor: 11,
  fresh: 12,
  worked: 13,
  active: 14,
  otherOwner: 15,
};
const user = (key: keyof typeof ids) => id(ids[key] as number);
const membership = (key: keyof typeof ids) => id((ids[key] as number) + 10);

let client: Sql;

/** Runs `work` as `app_runtime` signed in as that member, then rolls everything back. */
async function asMember<R>(
  tenantId: string,
  who: keyof typeof ids,
  work: (transaction: TransactionSql) => Promise<R>,
): Promise<R> {
  let result!: R;
  try {
    await client.begin(async (transaction) => {
      await transaction.unsafe('set local role app_runtime');
      await transaction`select set_config('app.tenant_id', ${tenantId}, true),
        set_config('app.membership_id', ${membership(who)}, true),
        set_config('app.actor_id', ${user(who)}, true)`;
      result = await work(transaction);
      throw new Error('rollback');
    });
  } catch (error) {
    if ((error as Error).message !== 'rollback') throw error;
  }
  return result;
}

const remove = async (transaction: TransactionSql, tenant: string, target: keyof typeof ids) =>
  (
    await transaction`select app.remove_staff_membership(${tenant}::uuid, ${membership(target)}::uuid) as outcome`
  )[0]?.outcome as string | null;

describe('removing a deactivated staff member, as the application role', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Removal Tenant', 'b574-removal'),
        ('${ids.otherTenant}', 'Other Removal Tenant', 'b574-other') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${user('owner')}', 'Olive Owner', 'b574-owner@example.test'),
        ('${user('supervisor')}', 'Sam Supervisor', 'b574-supervisor@example.test'),
        ('${user('fresh')}', 'Fresh Person', 'b574-fresh@example.test'),
        ('${user('worked')}', 'Worked Person', 'b574-worked@example.test'),
        ('${user('active')}', 'Active Person', 'b574-active@example.test'),
        ('${user('otherOwner')}', 'Other Owner', 'b574-other-owner@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${membership('owner')}', '${ids.tenant}', '${user('owner')}', 'ACTIVE'),
        ('${membership('supervisor')}', '${ids.tenant}', '${user('supervisor')}', 'ACTIVE'),
        ('${membership('fresh')}', '${ids.tenant}', '${user('fresh')}', 'DISABLED'),
        ('${membership('worked')}', '${ids.tenant}', '${user('worked')}', 'DISABLED'),
        ('${membership('active')}', '${ids.tenant}', '${user('active')}', 'ACTIVE'),
        ('${membership('otherOwner')}', '${ids.otherTenant}', '${user('otherOwner')}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Removal Legal') on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${membership('owner')}', 'OWNER', 'TENANT', null, null),
        ('${ids.tenant}', '${membership('supervisor')}', 'SUPERVISOR', 'LEGAL_ENTITY', '${ids.legal}', null),
        ('${ids.tenant}', '${membership('fresh')}', 'ATTENDANT', 'LEGAL_ENTITY', '${ids.legal}', null),
        ('${ids.tenant}', '${membership('worked')}', 'ATTENDANT', 'LEGAL_ENTITY', '${ids.legal}', null),
        ('${ids.otherTenant}', '${membership('otherOwner')}', 'OWNER', 'TENANT', null, null)
        on conflict do nothing;
      insert into app.staff_invitations
        (tenant_id, invited_email, invited_name, assigned_role, scope_type, legal_entity_id,
         token_hash, status, expires_at, created_by_user_id, created_by_membership_id)
        values ('${ids.tenant}', 'b574-someone@example.test', 'Someone', 'ADMINISTRATOR', 'TENANT',
                null, '${'b'.repeat(64)}', 'PENDING', now() + interval '1 day',
                '${user('worked')}', '${membership('worked')}')
        on conflict do nothing;
    `);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('erases a deactivated person who has no records', async () => {
    const result = await asMember(ids.tenant, 'owner', async (transaction) => ({
      outcome: await remove(transaction, ids.tenant, 'fresh'),
      left: (
        await transaction`select count(*)::int as n from app.memberships where id = ${membership('fresh')}`
      )[0]?.n,
    }));
    expect(result).toEqual({ outcome: 'DELETED', left: 0 });
  });

  it('hides, and does not erase, a person other records point at', async () => {
    const result = await asMember(ids.tenant, 'owner', async (transaction) => ({
      outcome: await remove(transaction, ids.tenant, 'worked'),
      row: (
        await transaction`select status, removed_at is not null as hidden from app.memberships
          where id = ${membership('worked')}`
      )[0],
    }));
    expect(result.outcome).toBe('HIDDEN');
    expect(result.row).toEqual({ status: 'DISABLED', hidden: true });
  });

  it('refuses active staff, oneself, a non-owner and another organisation', async () => {
    await asMember(ids.tenant, 'owner', async (transaction) => {
      expect(await remove(transaction, ids.tenant, 'active')).toBeNull();
      expect(await remove(transaction, ids.tenant, 'owner')).toBeNull();
    });
    await asMember(ids.tenant, 'supervisor', async (transaction) => {
      expect(await remove(transaction, ids.tenant, 'fresh')).toBeNull();
    });
    await asMember(ids.tenant, 'owner', async (transaction) => {
      expect(await remove(transaction, ids.otherTenant, 'fresh')).toBeNull();
    });
    const [row] = await client`select count(*)::int as n from app.memberships
      where id in (${membership('fresh')}, ${membership('active')}, ${membership('owner')})`;
    expect(row?.n).toBe(3);
  });
});
