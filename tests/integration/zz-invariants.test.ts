import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { failedInvariants, runInvariantChecks } from '../../src/modules/invariants/checks';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the invariants test.');
}

/**
 * G3: after every other suite has written its data (this file sorts last), the rules that must
 * always be true still are. A failure names the records that break a rule.
 */
let client: Sql;

describe('data invariants hold after the whole suite has run (G3)', () => {
  beforeAll(() => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => {
    await client.end();
  });

  it('reports every invariant, and none is broken', async () => {
    const results = await runInvariantChecks(drizzle(client) as never);
    expect(results.map((result) => result.code)).toEqual([
      'NO_NEGATIVE_STOCK',
      'CASH_NOT_DEPOSITED_TWICE',
      'DEPOSIT_EQUALS_ITS_COLLECTIONS',
      'PAYMENT_NOT_OVER_ALLOCATED',
      'APPROVED_DAY_HAS_DIPS',
    ]);
    expect(
      failedInvariants(results).map((result) => ({ rule: result.rule, found: result.violations })),
    ).toEqual([]);
  });
});
