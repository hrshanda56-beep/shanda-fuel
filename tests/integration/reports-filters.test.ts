import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { TABLE_REPORTS } from '../../src/modules/reporting/table-reports/definitions';
import { TABLE_REPORT_READERS } from '../../src/modules/reporting/table-reports/read';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for report filter tests.');

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);
const some = 'f1700000-0000-4000-8000-000000000001';

afterAll(async () => {
  await client.end();
});

describe('report readers with every filter chosen', () => {
  it('has a reader for every table report', () => {
    for (const report of TABLE_REPORTS)
      expect(TABLE_REPORT_READERS[report.slug]).toBeTypeOf('function');
  });

  it.each(TABLE_REPORTS.map((report) => report.slug))(
    '%s runs with all narrowing filters and returns rows as an array',
    async (slug) => {
      const rows = await TABLE_REPORT_READERS[slug]!(
        db as never,
        {
          tenantId: some,
          stationIds: [some],
          fromDate: '2026-10-01',
          toDate: '2026-10-31',
          productId: some,
          supplierId: some,
          customerId: some,
          employeeId: some,
          shiftTemplateId: some,
          paymentMethod: 'CASH',
        },
        { legalEntityIds: [some] },
      );
      expect(Array.isArray(rows)).toBe(true);
    },
  );
});
