import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for pnpm test:integration. Configure a dedicated test PostgreSQL database; the canonical integration gate does not skip.',
  );
}
let client: ReturnType<typeof postgres>;

describe('PostgreSQL integration harness', () => {
  beforeAll(() => {
    client = postgres(databaseUrl, { max: 1, prepare: false });
  });

  afterAll(async () => {
    await client?.end();
  });

  it('connects to the configured PostgreSQL test database', async () => {
    const result = await client<{ one: number }[]>`select 1 as one`;
    expect(result[0]?.one).toBe(1);
  });

  it('sees the namespaces from the canonical migration', async () => {
    const rows = await client<{ schema_name: string }[]>`
      select schema_name
      from information_schema.schemata
      where schema_name in ('auth', 'app', 'platform')
      order by schema_name
    `;

    expect(rows.map((row) => row.schema_name)).toEqual(['app', 'auth', 'platform']);
  });
});
