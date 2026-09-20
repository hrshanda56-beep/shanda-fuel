import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

describe('PostgreSQL integration harness', () => {
  it.skipIf(!databaseUrl)('can connect to the configured test database', async () => {
    const client = postgres(databaseUrl!, { max: 1, prepare: false });
    const result = await client<{ one: number }[]>`select 1 as one`;
    await client.end();
    expect(result[0]?.one).toBe(1);
  });
});
