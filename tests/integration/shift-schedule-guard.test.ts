import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the shift schedule guard test.');
}

const ids = {
  tenant: 'a6b00000-0000-4000-8000-000000000001',
  legal: 'a6b00000-0000-4000-8000-000000000011',
  station: 'a6b00000-0000-4000-8000-000000000021',
  otherStation: 'a6b00000-0000-4000-8000-000000000022',
  user: 'a6b00000-0000-4000-8000-000000000031',
  membership: 'a6b00000-0000-4000-8000-000000000041',
  day: 'a6b00000-0000-4000-8000-000000000051',
  otherDay: 'a6b00000-0000-4000-8000-000000000052',
  otherStationDay: 'a6b00000-0000-4000-8000-000000000053',
  dayTemplate: 'a6b00000-0000-4000-8000-000000000061',
  nightTemplate: 'a6b00000-0000-4000-8000-000000000062',
};

let client: Sql;
let counter = 0;

async function addShift(opts: {
  station?: string;
  day?: string;
  date?: string;
  template?: string | null;
  start: string;
  end: string;
  state?: string;
}) {
  counter += 1;
  const id = `a6b00000-0000-4000-8000-0000000001${String(counter).padStart(2, '0')}`;
  await client`
    insert into app.shifts
      (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at,
       shift_template_id, business_date)
    values (${id}, ${ids.tenant}, ${opts.station ?? ids.station}, ${opts.day ?? ids.day},
      ${opts.state ?? 'PLANNED'}, ${opts.start}::timestamptz, ${opts.end}::timestamptz,
      ${opts.template ?? null}, ${opts.date ?? '2026-10-01'})
  `;
  return id;
}

describe('A6: one shift per template per day, and no overlapping shifts', () => {
  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A6 Schedule Tenant', 'a6-schedule-tenant') on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.user}', 'A6 Actor', 'a6-schedule-actor@example.test') on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.user}', 'ACTIVE') on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A6 Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A6S1', 'A6 Station', 'ACTIVE', 'Africa/Harare'),
        ('${ids.otherStation}', '${ids.tenant}', '${ids.legal}', 'A6S2', 'A6 Other', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state) values
        ('${ids.day}', '${ids.tenant}', '${ids.station}', '2026-10-01', 'NOT_STARTED'),
        ('${ids.otherDay}', '${ids.tenant}', '${ids.station}', '2026-10-02', 'NOT_STARTED'),
        ('${ids.otherStationDay}', '${ids.tenant}', '${ids.otherStation}', '2026-10-01', 'NOT_STARTED')
        on conflict (id) do nothing;
      insert into app.shift_templates (id, tenant_id, station_id, code, name, created_by) values
        ('${ids.dayTemplate}', '${ids.tenant}', '${ids.station}', 'DAY', 'Day', '${ids.membership}'),
        ('${ids.nightTemplate}', '${ids.tenant}', '${ids.station}', 'NIGHT', 'Night', '${ids.membership}')
        on conflict (id) do nothing;
      delete from app.shifts where tenant_id = '${ids.tenant}';
    `);
  });

  afterAll(async () => {
    await client.end();
  });

  it('accepts the first shift for a template', async () => {
    await expect(
      addShift({
        template: ids.dayTemplate,
        start: '2026-10-01T04:00:00Z',
        end: '2026-10-01T16:00:00Z',
      }),
    ).resolves.toBeTruthy();
  });

  it('refuses a second shift for the same template on the same day', async () => {
    await expect(
      addShift({
        template: ids.dayTemplate,
        start: '2026-10-01T17:00:00Z',
        end: '2026-10-01T20:00:00Z',
      }),
    ).rejects.toThrow(/already been opened/);
  });

  it('refuses a shift that overlaps an existing one, even for another template', async () => {
    await expect(
      addShift({
        template: ids.nightTemplate,
        start: '2026-10-01T10:00:00Z',
        end: '2026-10-01T22:00:00Z',
      }),
    ).rejects.toThrow(/overlaps another shift/);
  });

  it('accepts a shift that starts exactly when the previous one ends', async () => {
    await expect(
      addShift({
        template: ids.nightTemplate,
        start: '2026-10-01T16:00:00Z',
        end: '2026-10-02T04:00:00Z',
      }),
    ).resolves.toBeTruthy();
  });

  it('allows the same template on a different business day', async () => {
    await expect(
      addShift({
        day: ids.otherDay,
        date: '2026-10-02',
        template: ids.dayTemplate,
        start: '2026-10-02T04:00:00Z',
        end: '2026-10-02T16:00:00Z',
      }),
    ).resolves.toBeTruthy();
  });

  it('keeps stations apart: the same time at another station is fine', async () => {
    await expect(
      addShift({
        station: ids.otherStation,
        day: ids.otherStationDay,
        template: null,
        start: '2026-10-01T04:00:00Z',
        end: '2026-10-01T16:00:00Z',
      }),
    ).resolves.toBeTruthy();
  });

  it('ignores a cancelled shift when checking', async () => {
    await client`
      update app.shifts set state = 'CANCELLED_BEFORE_START'
      where tenant_id = ${ids.tenant} and station_id = ${ids.station}
        and business_day_id = ${ids.day} and shift_template_id = ${ids.dayTemplate}
    `;
    await expect(
      addShift({
        template: ids.dayTemplate,
        start: '2026-10-01T04:00:00Z',
        end: '2026-10-01T16:00:00Z',
      }),
    ).resolves.toBeTruthy();
  });

  // Last, because it deliberately leaves an overlapping record behind.
  it('leaves an ad-hoc shift with no template to the other rules', async () => {
    await expect(
      addShift({ template: null, start: '2026-10-01T15:00:00Z', end: '2026-10-01T18:00:00Z' }),
    ).resolves.toBeTruthy();
  });
});
