import { expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/platform/db/schema';
import { loadTenantMembershipWithDatabase } from '../../src/modules/tenancy/authority';
import {
  memoizeRequestRead,
  withRequestReadScope,
} from '../../src/platform/security/request-read-scope';

// Explicit read-only benchmark; never discovers identities or writes fixtures.
const identityId = process.env.NAVIGATION_BENCHMARK_IDENTITY_ID;
const tenantId = process.env.NAVIGATION_BENCHMARK_TENANT_ID;
it.skipIf(!identityId || !tenantId)(
  'measures repeated authorized membership reads versus request reuse',
  async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    let queries = 0;
    const db = drizzle(client, {
      schema,
      logger: {
        logQuery() {
          queries++;
        },
      },
    });
    const read = () => loadTenantMembershipWithDatabase(identityId!, tenantId!, db);
    try {
      await client`select 1`;
      let start = performance.now();
      const first = await read();
      const second = await read();
      expect(first?.status).toBe('ACTIVE');
      expect(second).toEqual(first);
      const repeated = { queries, ms: Math.round(performance.now() - start) };
      queries = 0;
      start = performance.now();
      const namespace = Symbol('membership-benchmark');
      await withRequestReadScope(async () => {
        const a = await memoizeRequestRead(namespace, 'same-membership', read);
        const b = await memoizeRequestRead(namespace, 'same-membership', read);
        expect(a).toEqual(first);
        expect(b).toBe(a);
      });
      const reused = { queries, ms: Math.round(performance.now() - start) };
      expect(reused.queries).toBe(4);
      expect(repeated.queries).toBe(8);
      console.info(JSON.stringify({ benchmark: 'membership-read-reuse', repeated, reused }));
    } finally {
      await client.end();
    }
  },
  30000,
);
