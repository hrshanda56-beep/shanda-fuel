import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for opening-balance integration tests. Configure a dedicated PostgreSQL test database.',
  );
}

const ids = {
  tenant: randomUUID(),
  actor: randomUUID(),
  membership: randomUUID(),
  batch: randomUUID(),
};

let client: Sql;

describe('opening balance batch PostgreSQL invariants', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
    await client`
      select set_config('app.tenant_id', ${ids.tenant}, false);
      select set_config('app.actor_id', ${ids.actor}, false);
      select set_config('app.membership_id', ${ids.membership}, false);
      insert into app.tenants (id, name, slug)
      values (${ids.tenant}, 'Opening Balance Integration', ${`opening-${ids.tenant.slice(0, 8)}`});
      insert into app.users (id, name, email)
      values (${ids.actor}, 'Opening Balance Operator', ${`opening-${ids.actor}@example.test`});
      insert into app.memberships (id, tenant_id, identity_id, status)
      values (${ids.membership}, ${ids.tenant}, ${ids.actor}, 'ACTIVE');
    `;
  });

  afterAll(async () => {
    await client?.end();
  });

  it('permits approval then one-way locking and rejects post-lock edits', async () => {
    await client`
      insert into app.opening_balance_batches
        (id, tenant_id, as_of_date, source_filename, source_hash, state, line_count, created_by)
      values
        (${ids.batch}, ${ids.tenant}, '2026-10-01', 'opening.csv', ${randomUUID()}, 'DRAFT', 1, ${ids.membership});
    `;

    await client`
      update app.opening_balance_batches
      set state = 'APPROVED', approved_by = ${ids.membership}, approved_at = now(), version = 1, updated_at = now()
      where tenant_id = ${ids.tenant} and id = ${ids.batch};
    `;
    await client`
      update app.opening_balance_batches
      set state = 'LOCKED', locked_by = ${ids.membership}, locked_at = now(), version = 2, updated_at = now()
      where tenant_id = ${ids.tenant} and id = ${ids.batch};
    `;

    await expect(
      client`
        update app.opening_balance_batches
        set source_filename = 'tampered.csv'
        where tenant_id = ${ids.tenant} and id = ${ids.batch};
      `,
    ).rejects.toThrow(/identity is immutable|immutable/);

    await expect(
      client`
        update app.opening_balance_batches
        set state = 'DRAFT'
        where tenant_id = ${ids.tenant} and id = ${ids.batch};
      `,
    ).rejects.toThrow(/immutable/);
  });
});
