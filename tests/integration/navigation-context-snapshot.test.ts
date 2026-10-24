import { PostgresJsDatabase, PostgresJsSession } from 'drizzle-orm/postgres-js';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Sql } from 'postgres';
import { preparedDrizzleClient } from '../../src/platform/db/prepared-client';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type TransactionSql } from 'postgres';

// This suite installs the candidate function and fixtures inside rolled-back
// transactions. Never infer permission to run it from a configured DATABASE_URL.
const enabled = process.env.RUN_NAVIGATION_SNAPSHOT_DB_TESTS === '1';
const url = process.env.TEST_DATABASE_URL;
const migration = readFileSync(
  new URL('../../src/platform/db/migrations/0034_navigation_context_snapshot.sql', import.meta.url),
  'utf8',
);
let client: ReturnType<typeof postgres>;
const rollback = new Error('navigation test rollback');

type Snapshot = {
  tenant_id: string;
  identity_id: string;
  membership_id: string;
  roles: unknown[];
  grants: { reason: string }[];
  context_rows: { organisation_id: string; station_id: string }[];
};

describe.skipIf(!enabled)(
  'navigation snapshot under app_runtime and FORCE RLS',
  { timeout: 120_000 },
  () => {
    beforeAll(() => {
      if (!url) throw new Error('An explicitly approved TEST_DATABASE_URL is required');
      const host = new URL(url).hostname;
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(host) &&
        host !== process.env.NAVIGATION_SNAPSHOT_APPROVED_HOST
      ) {
        throw new Error('TEST_DATABASE_URL host requires explicit operator approval');
      }
      client = postgres(url, {
        max: 1,
        prepare: process.env.DATABASE_PREPARED_STATEMENTS === '1',
        onnotice: () => undefined,
      });
      if (process.env.DATABASE_PREPARED_STATEMENTS === '1') client = preparedDrizzleClient(client);
    });
    afterAll(async () => {
      await client?.end();
    });

    async function fixture(
      work: (
        tx: TransactionSql,
        ids: { actor: string; other: string; tenants: string[] },
      ) => Promise<void>,
    ) {
      try {
        await client.begin(async (tx) => {
          await tx.unsafe(migration.replaceAll('--> statement-breakpoint', ''));
          const actor = randomUUID(),
            other = randomUUID();
          const tenants = [randomUUID(), randomUUID(), randomUUID()];
          await tx`insert into app.users (id, name) values (${actor}, 'Navigation A'), (${other}, 'Navigation B')`;
          await tx`insert into app.auth_identities (internal_user_id,provider,provider_user_id) values (${actor},'CLERK',${'user_' + actor}),(${other},'CLERK',${'user_' + other})`;
          for (const [index, tenant] of tenants.entries()) {
            const membership = randomUUID(),
              entity = randomUUID(),
              station = randomUUID();
            await tx`insert into app.tenants (id, name, slug) values (${tenant}, 'Navigation test', ${tenant})`;
            await tx`insert into app.memberships (id, tenant_id, identity_id, status) values (${membership}, ${tenant}, ${index === 2 ? other : actor}, 'ACTIVE')`;
            await tx`insert into app.legal_entities (id, tenant_id, legal_name) values (${entity}, ${tenant}, 'Test entity')`;
            await tx`insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values (${station}, ${tenant}, ${entity}, 'TEST', 'Test station', 'ACTIVE', 'Africa/Harare')`;
            await tx`insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type) values (${tenant}, ${membership}, 'SUPERVISOR', 'TENANT')`;
            for (const state of ['live', 'expired', 'revoked']) {
              await tx`insert into app.temporary_permission_grants (tenant_id, membership_id, permission_code, scope_type, expires_at, revoked_at, reason)
              values (${tenant}, ${membership}, 'report.view', 'TENANT',
                ${state === 'expired' ? new Date('2000-01-01') : new Date('2090-01-01')},
                ${state === 'revoked' ? new Date() : null}, ${state})`;
            }
          }
          await tx.unsafe('set local role app_runtime');
          await work(tx, { actor, other, tenants });
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
    }

    it('returns only the actor memberships with tenant-bound context and current permissions', async () => {
      await fixture(async (tx, { actor, tenants }) => {
        const rows = await tx<
          Snapshot[]
        >`select * from app.read_navigation_context(${actor}::uuid)`;
        expect(rows.map((row) => row.tenant_id).sort()).toEqual(tenants.slice(0, 2).sort());
        for (const row of rows) {
          expect(row.identity_id).toBe(actor);
          expect(row.roles).toHaveLength(1);
          expect(row.grants.map((grant) => grant.reason)).toEqual(['live']);
          expect(row.context_rows).toHaveLength(1);
          expect(row.context_rows[0]?.organisation_id).toBe(row.tenant_id);
        }
      });
    });
    it('does not retain another actor or tenant on the same connection', async () => {
      await fixture(async (tx, { actor, other, tenants }) => {
        await tx`select * from app.read_navigation_context(${actor}::uuid)`;
        const rows = await tx<
          Snapshot[]
        >`select * from app.read_navigation_context(${other}::uuid)`;
        expect(rows.map((row) => row.tenant_id)).toEqual([tenants[2]]);
        expect(
          await tx`select * from app.read_navigation_context(${randomUUID()}::uuid)`,
        ).toHaveLength(0);
      });
    });
    it('combines provider identity and authority through Drizzle with reusable actor-isolated plans', async () => {
      await fixture(async (tx, { actor, other, tenants }) => {
        const dialect = new PgDialect();
        const database = new PostgresJsDatabase(
          dialect,
          new PostgresJsSession(tx as unknown as Sql, dialect, undefined),
          undefined,
        );
        const read = (providerUserId: string) =>
          database.execute<{ internal_user_id: string; navigation_snapshot: Snapshot[] }>(sql`
          select identity.internal_user_id, snapshot.navigation_snapshot
          from app.resolve_auth_identity('CLERK', ${providerUserId}) identity
          cross join lateral (
            select coalesce(jsonb_agg(navigation), '[]'::jsonb) as navigation_snapshot
            from app.read_navigation_context(identity.internal_user_id) navigation
          ) snapshot
        `);
        const a = await read('user_' + actor);
        expect(a[0]?.internal_user_id).toBe(actor);
        expect(a[0]?.navigation_snapshot.map((row) => row.tenant_id).sort()).toEqual(
          tenants.slice(0, 2).sort(),
        );
        const b = await read('user_' + other);
        expect(b[0]?.internal_user_id).toBe(other);
        expect(b[0]?.navigation_snapshot.map((row) => row.tenant_id)).toEqual([tenants[2]]);
        expect(await read('unprovisioned')).toHaveLength(0);
        if (process.env.DATABASE_PREPARED_STATEMENTS === '1') {
          const plans =
            await tx`select name from pg_prepared_statements where statement like '%from app.resolve_auth_identity%' and statement like '%jsonb_agg(navigation)%' and statement not like '%pg_prepared_statements%'`;
          expect(plans.length).toBeGreaterThan(0);
        }
      });
    });
    it('restores all five caller context settings inside an outer transaction', async () => {
      await fixture(async (tx, { actor }) => {
        const names = [
          'app.actor_id',
          'app.tenant_id',
          'app.membership_id',
          'app.legal_entity_id',
          'app.station_id',
        ];
        const expected = names.map(() => randomUUID());
        for (const [index, name] of names.entries())
          await tx`select set_config(${name}, ${expected[index]!}, true)`;
        await tx`select * from app.read_navigation_context(${actor}::uuid)`;
        for (const [index, name] of names.entries()) {
          const [row] = await tx`select current_setting(${name}, true) as value`;
          expect(row?.value).toBe(expected[index]);
        }
      });
    });
    it('fails for missing actor and preserves caller settings after rollback', async () => {
      await fixture(async (tx, { actor }) => {
        await tx`select set_config('app.actor_id', ${actor}, true)`;
        await expect(
          tx.savepoint(async (savepoint) => {
            await savepoint`select * from app.read_navigation_context(null::uuid)`;
          }),
        ).rejects.toThrow('Authenticated actor required');
        const [row] = await tx`select current_setting('app.actor_id', true) as value`;
        expect(row?.value).toBe(actor);
      });
    });
    it('excludes inactive memberships', async () => {
      await fixture(async (tx, { actor, tenants }) => {
        await tx.unsafe('reset role');
        await tx`update app.memberships set status = 'SUSPENDED' where tenant_id = ${tenants[1]!} and identity_id = ${actor}`;
        await tx.unsafe('set local role app_runtime');
        const rows = await tx<
          Snapshot[]
        >`select * from app.read_navigation_context(${actor}::uuid)`;
        expect(rows.map((row) => row.tenant_id)).toEqual([tenants[0]]);
      });
    });
  },
);
