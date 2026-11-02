import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertApproverAllowed } from '../../src/modules/customers/approver';
import { soleOwnerMayApproveOwn } from '../../src/platform/security/separation-of-duties';

/**
 * Row-level security lets a person read only their own membership unless they hold a tenant-wide
 * owner or administrator role. Code that joined app.memberships therefore saw nothing for station
 * staff: a supervisor could not pick an owner as approver, a station-level owner looked like the
 * only owner, and other people's names came back as "Unknown". Those paths now use
 * app.member_directory (0100). This runs the real application code as `app_runtime`, as station
 * staff, because every other integration test seeds and reads as a privileged role.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the staff visibility test.');

const T = 'b5720000-0000-4000-8000-0000000000';
const id = (n: number) => `${T}${String(n).padStart(2, '0')}`;
const ids = {
  tenant: id(1),
  legal: id(2),
  s1: id(3),
  s2: id(4),
  otherTenant: id(5),
  otherLegal: id(6),
  otherStation: id(7),
  // users 10..19, memberships 20..29 (same order)
  owner: 10,
  admin: 11,
  supervisor: 12,
  attendant: 13,
  otherOwnerA: 14,
  otherOwnerB: 15,
};
const user = (key: keyof typeof ids) => id(ids[key] as number);
const membership = (key: keyof typeof ids) => id((ids[key] as number) + 10);

const dialect = new PgDialect();
let client: Sql;

/** A drizzle-style executor that runs the rendered SQL inside the open transaction. */
function executor(transaction: TransactionSql) {
  return {
    execute: async (query: SQL) => {
      const rendered = dialect.sqlToQuery(query);
      return transaction.unsafe(rendered.sql, rendered.params as never[]);
    },
  };
}

/** Runs `work` as `app_runtime` signed in as that member, then rolls everything back. */
async function asMember<T>(
  tenantId: string,
  who: keyof typeof ids,
  work: (transaction: TransactionSql) => Promise<T>,
): Promise<T> {
  let result!: T;
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

describe('station-level staff can see who people are, as the application role', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Visibility Tenant', 'b572-visibility'),
        ('${ids.otherTenant}', 'Station Owners Tenant', 'b572-station-owners') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${user('owner')}', 'Olive Owner', 'b572-owner@example.test'),
        ('${user('admin')}', 'Adam Admin', 'b572-admin@example.test'),
        ('${user('supervisor')}', 'Sam Supervisor', 'b572-supervisor@example.test'),
        ('${user('attendant')}', 'Ada Attendant', 'b572-attendant@example.test'),
        ('${user('otherOwnerA')}', 'Station Owner A', 'b572-owner-a@example.test'),
        ('${user('otherOwnerB')}', 'Station Owner B', 'b572-owner-b@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${membership('owner')}', '${ids.tenant}', '${user('owner')}', 'ACTIVE'),
        ('${membership('admin')}', '${ids.tenant}', '${user('admin')}', 'ACTIVE'),
        ('${membership('supervisor')}', '${ids.tenant}', '${user('supervisor')}', 'ACTIVE'),
        ('${membership('attendant')}', '${ids.tenant}', '${user('attendant')}', 'ACTIVE'),
        ('${membership('otherOwnerA')}', '${ids.otherTenant}', '${user('otherOwnerA')}', 'ACTIVE'),
        ('${membership('otherOwnerB')}', '${ids.otherTenant}', '${user('otherOwnerB')}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Visibility Legal'),
        ('${ids.otherLegal}', '${ids.otherTenant}', 'Station Owners Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.s1}', '${ids.tenant}', '${ids.legal}', 'B572A', 'Station One', 'ACTIVE', 'Africa/Harare'),
        ('${ids.s2}', '${ids.tenant}', '${ids.legal}', 'B572B', 'Station Two', 'ACTIVE', 'Africa/Harare'),
        ('${ids.otherStation}', '${ids.otherTenant}', '${ids.otherLegal}', 'B572C', 'Owned Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${membership('owner')}', 'OWNER', 'TENANT', null, null),
        ('${ids.tenant}', '${membership('admin')}', 'ADMINISTRATOR', 'TENANT', null, null),
        ('${ids.tenant}', '${membership('supervisor')}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.s1}'),
        ('${ids.tenant}', '${membership('attendant')}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.s1}'),
        ('${ids.otherTenant}', '${membership('otherOwnerA')}', 'OWNER', 'STATION', '${ids.otherLegal}', '${ids.otherStation}'),
        ('${ids.otherTenant}', '${membership('otherOwnerB')}', 'OWNER', 'STATION', '${ids.otherLegal}', '${ids.otherStation}')
        on conflict do nothing;
    `);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('shows a station supervisor the names (only) of the organisation’s members', async () => {
    const rows = await asMember(
      ids.tenant,
      'supervisor',
      (transaction) => transaction`select * from app.member_directory(${ids.tenant}::uuid)`,
    );
    expect(rows.map((row) => row.name).sort()).toEqual([
      'Ada Attendant',
      'Adam Admin',
      'Olive Owner',
      'Sam Supervisor',
    ]);
    expect(Object.keys(rows[0]!).sort()).toEqual(['id', 'name', 'status', 'usable']);
  });

  it('shows an attendant the directory too, but nothing of another organisation', async () => {
    const mine = await asMember(
      ids.tenant,
      'attendant',
      (transaction) =>
        transaction`select count(*)::int as n from app.member_directory(${ids.tenant}::uuid)`,
    );
    expect(mine[0]?.n).toBe(4);
    const other = await asMember(
      ids.tenant,
      'attendant',
      (transaction) =>
        transaction`select count(*)::int as n from app.member_directory(${ids.otherTenant}::uuid)`,
    );
    expect(other[0]?.n).toBe(0);
  });

  it('shows nothing without a signed-in member', async () => {
    const rows = await client.begin(async (transaction) => {
      await transaction.unsafe('set local role app_runtime');
      return transaction`select count(*)::int as n from app.member_directory(${ids.tenant}::uuid)`;
    });
    expect(rows[0]?.n).toBe(0);
  });

  it('lets a station supervisor pick an owner or administrator as approver, and nobody else', async () => {
    const context = {
      tenantId: ids.tenant,
      authority: { membership: { membershipId: membership('supervisor') } },
    } as never;
    await asMember(ids.tenant, 'supervisor', async (transaction) => {
      const run = (who: keyof typeof ids) =>
        assertApproverAllowed(executor(transaction) as never, context, membership(who));
      await expect(run('owner')).resolves.toBeUndefined();
      await expect(run('admin')).resolves.toBeUndefined();
      await expect(run('attendant')).rejects.toThrow(/Only an owner or an administrator/);
      await expect(run('supervisor')).rejects.toThrow(/Only an owner or an administrator/);
    });
  });

  it('sees a second station-level owner, so a station owner is not the "sole owner"', async () => {
    await asMember(ids.otherTenant, 'otherOwnerA', async (transaction) => {
      const sole = await soleOwnerMayApproveOwn(executor(transaction) as never, {
        tenantId: ids.otherTenant,
        stationId: ids.otherStation,
        membershipId: membership('otherOwnerA'),
      });
      expect(sole).toBe(false);
    });
  });

  it('still treats the only owner as the sole owner', async () => {
    await asMember(ids.tenant, 'owner', async (transaction) => {
      const sole = await soleOwnerMayApproveOwn(executor(transaction) as never, {
        tenantId: ids.tenant,
        stationId: ids.s1,
        membershipId: membership('owner'),
      });
      expect(sole).toBe(true);
    });
  });
});
