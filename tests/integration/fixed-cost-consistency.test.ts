import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readRecurringCostDays } from '../../src/modules/reporting/queries';
import { readStationDailyReport } from '../../src/modules/reporting/table-reports/read-more';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the fixed cost consistency test.');
}

// B6: a recurring cost counts from its start date with no "add the month" step, and the Station
// Daily Report shows exactly what the management report and Daily Profit count.
const ids = {
  tenant: 'b6c00000-0000-4000-8000-000000000001',
  legal: 'b6c00000-0000-4000-8000-000000000011',
  user: 'b6c00000-0000-4000-8000-000000000031',
  membership: 'b6c00000-0000-4000-8000-000000000041',
  station: randomUUID(),
  category: randomUUID(),
  rent: randomUUID(),
};

let client: Sql;
const filters = (fromDate: string, toDate: string) => ({
  tenantId: ids.tenant,
  stationIds: [ids.station],
  fromDate,
  toDate,
});
// The readers take a transaction; a plain connection runs the same SQL.
const connection = () => drizzle(client) as never;

describe('B6: fixed costs are one rule on every screen', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'B6 Fixed Tenant', 'b6-fixed-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.user}', 'B6 Actor', 'b6-fixed-actor@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.user}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'B6 Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'B6${ids.station.slice(0, 6)}', 'B6 Station', 'ACTIVE', 'Africa/Harare');
      insert into app.expense_categories (id, tenant_id, code, name, classification, created_by) values
        ('${ids.category}', '${ids.tenant}', 'RENT${ids.station.slice(0, 4).toUpperCase()}', 'Rent', 'FIXED_COST', '${ids.membership}');
      insert into app.recurring_cost_templates
        (id, tenant_id, legal_entity_id, station_id, category_id, name, amount, start_date, created_by) values
        ('${ids.rent}', '${ids.tenant}', '${ids.legal}', '${ids.station}', '${ids.category}', 'Rent', 3100.0000, '2026-10-15', '${ids.membership}');
    `);
  });

  afterAll(async () => {
    await client.end();
  });

  it('counts the cost from its start date even though no month was ever added', async () => {
    const days = await readRecurringCostDays(
      connection(),
      filters('2026-10-01', '2026-10-31'),
      new Set(),
    );
    expect(days).toHaveLength(17);
    expect(days[0]).toMatchObject({ businessDate: '2026-10-15', amount: '100.0000', name: 'Rent' });
    expect(days.at(-1)).toMatchObject({ businessDate: '2026-10-31' });
  });

  it('shows the same cost, day by day, in the Station Daily Report', async () => {
    const rows = await readStationDailyReport(
      connection(),
      filters('2026-10-01', '2026-10-31') as never,
      { legalEntityIds: [ids.legal] },
    );
    const mine = rows.filter((row) => row.fixedCosts !== null && Number(row.fixedCosts) > 0);
    expect(mine).toHaveLength(17);
    expect(mine.every((row) => String(row.date) >= '2026-10-15')).toBe(true);
    const total = mine.reduce((sum, row) => sum + Number(row.fixedCosts), 0);
    expect(total.toFixed(4)).toBe('1700.0000');
  });

  it('does not count a day twice once it has a recorded recognition', async () => {
    const days = await readRecurringCostDays(
      connection(),
      filters('2026-10-15', '2026-10-17'),
      new Set([`${ids.station}:2026-10-16:${ids.rent}`]),
    );
    expect(days.map((day) => day.businessDate)).toEqual(['2026-10-15', '2026-10-17']);
  });
});
