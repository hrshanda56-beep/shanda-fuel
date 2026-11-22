import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';
import { seedClerkSession, clerkHeaders } from './auth-session-fixtures';
import { addDays } from '../../src/modules/forecourt/past-day-rules';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the past-day entry integration tests.');
}

const ids = {
  tenant: 'a3d00000-0000-4000-8000-000000000001',
  otherTenant: 'a3d00000-0000-4000-8000-000000000002',
  legal: 'a3d00000-0000-4000-8000-000000000011',
  station: 'a3d00000-0000-4000-8000-000000000021',
  supervisor: 'a3d00000-0000-4000-8000-000000000031',
  supervisorMembership: 'a3d00000-0000-4000-8000-000000000041',
  supervisorSession: 'a3d00000-0000-4000-8000-000000000111',
  owner: 'a3d00000-0000-4000-8000-000000000032',
  ownerMembership: 'a3d00000-0000-4000-8000-000000000042',
  ownerSession: 'a3d00000-0000-4000-8000-000000000112',
  morning: 'a3d00000-0000-4000-8000-000000000201',
  afternoon: 'a3d00000-0000-4000-8000-000000000202',
  attendant: 'a3d00000-0000-4000-8000-000000000033',
  attendantMembership: 'a3d00000-0000-4000-8000-000000000043',
  product: 'a3d00000-0000-4000-8000-000000000301',
  pump: 'a3d00000-0000-4000-8000-000000000302',
  nozzle: 'a3d00000-0000-4000-8000-000000000303',
  meter: 'a3d00000-0000-4000-8000-000000000304',
  installation: 'a3d00000-0000-4000-8000-000000000305',
  price: 'a3d00000-0000-4000-8000-000000000306',
};
const supervisorToken = 'a3d-supervisor-token';
const ownerToken = 'a3d-owner-token';

let client: Sql;

async function post(input: Record<string, unknown>, token: string) {
  return forecourtCommandPost(
    new Request('http://127.0.0.1:3000/api/forecourt/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders(token, input),
        'content-type': 'application/json',
        'idempotency-key': `a3d-${randomUUID()}`,
      },
      body: JSON.stringify(input),
    }),
  );
}

async function openPast(businessDate: string, token = supervisorToken) {
  return post(
    {
      commandType: 'OpenPastBusinessDay',
      tenantId: ids.tenant,
      stationId: ids.station,
      businessDayId: randomUUID(),
      businessDate,
    },
    token,
  );
}

async function stationToday(): Promise<string> {
  const rows = await client<{ d: string }[]>`
    select to_char((now() at time zone 'Africa/Harare')::date, 'YYYY-MM-DD') as d
  `;
  return rows[0]!.d;
}

describe('past-day entry: OpenPastBusinessDay', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-a3-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-a3-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Past Day Tenant', 'past-day-tenant'),
        ('${ids.otherTenant}', 'Past Day Other Tenant', 'past-day-other-tenant')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.supervisor}', 'Past Day Supervisor', 'past-day-supervisor@example.test'),
        ('${ids.owner}', 'Past Day Owner', 'past-day-owner@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisor}', 'ACTIVE'),
        ('${ids.ownerMembership}', '${ids.tenant}', '${ids.owner}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Past Day Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'PDE1', 'Past Day Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.ownerMembership}', 'ADMINISTRATOR', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict do nothing;
      insert into app.shift_templates (id, tenant_id, station_id, code, name, duration_minutes, start_time, created_by) values
        ('${ids.morning}', '${ids.tenant}', '${ids.station}', 'AM', 'Morning', 480, '06:00', '${ids.supervisorMembership}'),
        ('${ids.afternoon}', '${ids.tenant}', '${ids.station}', 'PM', 'Afternoon', 480, '14:00', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.attendant}', 'Past Day Attendant', 'past-day-attendant@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.attendantMembership}', '${ids.tenant}', '${ids.attendant}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.attendantMembership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.station}')
        on conflict do nothing;
      insert into app.products (id, tenant_id, code, name)
        values ('${ids.product}', '${ids.tenant}', 'PDE-DIESEL', 'Diesel') on conflict (id) do nothing;
      insert into app.pumps (id, tenant_id, station_id, number)
        values ('${ids.pump}', '${ids.tenant}', '${ids.station}', '1') on conflict (id) do nothing;
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id)
        values ('${ids.nozzle}', '${ids.tenant}', '${ids.station}', '${ids.pump}', '1', '${ids.product}') on conflict (id) do nothing;
      insert into app.meters (id, tenant_id, serial_number)
        values ('${ids.meter}', '${ids.tenant}', 'PDE-METER-1') on conflict (id) do nothing;
      insert into app.meter_installations (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
        values ('${ids.installation}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.meter}', '2020-01-01T00:00:00Z', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.selling_prices (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
        values ('${ids.price}', '${ids.tenant}', '${ids.station}', '${ids.product}', '2020-01-01T00:00:00Z', 1.500000, 'DRAFT', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      update app.selling_prices set state = 'PENDING_APPROVAL' where id = '${ids.price}' and state = 'DRAFT';
      update app.selling_prices set state = 'APPROVED', approved_by = '${ids.ownerMembership}', approved_at = clock_timestamp() where id = '${ids.price}' and state = 'PENDING_APPROVAL';
      update app.selling_prices set state = 'PENDING_STATION_ACTIVATION' where id = '${ids.price}' and state = 'APPROVED';
      update app.selling_prices set state = 'BOUNDARIES_IN_PROGRESS' where id = '${ids.price}' and state = 'PENDING_STATION_ACTIVATION';
      update app.selling_prices set state = 'ACTIVE' where id = '${ids.price}' and state = 'BOUNDARIES_IN_PROGRESS';
      delete from app.shifts where station_id = '${ids.station}';
      delete from app.station_business_days where station_id = '${ids.station}';
      update app.stations set go_live_date = null where id = '${ids.station}';
    `);
    await seedClerkSession(client, ids.supervisorSession, supervisorToken, ids.supervisor, true);
    await seedClerkSession(client, ids.ownerSession, ownerToken, ids.owner, true);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('records yesterday as an OPEN day marked entered late, with who and when', async () => {
    const date = addDays(await stationToday(), -1);
    const response = await openPast(date);
    expect(response.status).toBe(200);
    const rows = await client<
      { state: string; entered_late: boolean; entered_late_by: string; entered_late_at: Date }[]
    >`
      select state, entered_late, entered_late_by, entered_late_at
      from app.station_business_days
      where station_id = ${ids.station} and business_date = ${date}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: 'OPEN',
      entered_late: true,
      entered_late_by: ids.supervisorMembership,
    });
    expect(rows[0]!.entered_late_at).toBeInstanceOf(Date);
  });

  it('refuses the same day twice, today, and the future', async () => {
    const today = await stationToday();
    expect((await openPast(addDays(today, -1))).status).toBe(409);
    expect((await openPast(today)).status).toBe(400);
    expect((await openPast(addDays(today, 1))).status).toBe(400);
  });

  it('lets a supervisor go back 7 days but sends older days to the owner', async () => {
    const today = await stationToday();
    expect((await openPast(addDays(today, -7))).status).toBe(200);
    expect((await openPast(addDays(today, -8))).status).toBe(400);
    expect((await openPast(addDays(today, -8), ownerToken)).status).toBe(200);
    expect((await openPast(addDays(today, -91), ownerToken)).status).toBe(400);
  });

  it('refuses days before the station go-live date', async () => {
    const today = await stationToday();
    await client`update app.stations set go_live_date = ${addDays(today, -3)} where id = ${ids.station}`;
    try {
      expect((await openPast(addDays(today, -4), ownerToken)).status).toBe(400);
      expect((await openPast(addDays(today, -3), ownerToken)).status).toBe(200);
    } finally {
      await client`update app.stations set go_live_date = null where id = ${ids.station}`;
    }
  });

  it('lets the owner set and clear the start date, refuses a supervisor and a date that is not past', async () => {
    const today = await stationToday();
    const body = (goLiveDate: string | null) => ({
      commandType: 'SetStationGoLiveDate',
      tenantId: ids.tenant,
      stationId: ids.station,
      goLiveDate,
    });
    try {
      expect((await post(body(addDays(today, -10)), supervisorToken)).status).toBe(403);
      expect((await post(body(today), ownerToken)).status).toBe(400);
      expect((await post(body(addDays(today, -10)), ownerToken)).status).toBe(200);
      const set = await client<{ go_live_date: string | null }[]>`
        select go_live_date from app.stations where id = ${ids.station}`;
      expect(set[0]!.go_live_date).toBe(addDays(today, -10));
      expect((await post(body(null), ownerToken)).status).toBe(200);
      const cleared = await client<{ go_live_date: string | null }[]>`
        select go_live_date from app.stations where id = ${ids.station}`;
      expect(cleared[0]!.go_live_date).toBeNull();
    } finally {
      await client`update app.stations set go_live_date = null where id = ${ids.station}`;
    }
  });

  it('does not leave a live day behind: ordinary days stay not entered late', async () => {
    const rows = await client<{ n: number }[]>`
      select count(*)::int as n from app.station_business_days
      where station_id = ${ids.station} and entered_late = false
    `;
    expect(rows[0]!.n).toBe(0);
  });

  it('stamps a late day’s shifts from the schedule, so they line up and never overlap', async () => {
    const date = addDays(await stationToday(), -2);
    const dayId = randomUUID();
    const open = await post(
      {
        commandType: 'OpenPastBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId: dayId,
        businessDate: date,
      },
      supervisorToken,
    );
    expect(open.status).toBe(200);
    for (const templateId of [ids.morning, ids.afternoon]) {
      const shiftId = randomUUID();
      const start = await post(
        {
          commandType: 'StartShift',
          tenantId: ids.tenant,
          stationId: ids.station,
          businessDayId: dayId,
          shiftId,
          expectedVersion: 0,
          shiftTemplateId: templateId,
        },
        supervisorToken,
      );
      expect(start.status).toBe(200);
    }
    const shifts = await client<{ code: string; start: string; opened: string }[]>`
      select t.code,
        to_char(s.planned_start_at at time zone 'Africa/Harare', 'HH24:MI') as start,
        to_char(s.opened_at at time zone 'Africa/Harare', 'HH24:MI') as opened
      from app.shifts s join app.shift_templates t on t.id = s.shift_template_id
      where s.business_day_id = ${dayId} order by s.planned_start_at
    `;
    expect(shifts).toEqual([
      { code: 'AM', start: '06:00', opened: '06:00' },
      { code: 'PM', start: '14:00', opened: '14:00' },
    ]);
  });
  it('closes two late shifts end to end: readings chain, times come from the schedule', async () => {
    const date = addDays(await stationToday(), -4);
    const dayId = randomUUID();
    expect(
      (
        await post(
          {
            commandType: 'OpenPastBusinessDay',
            tenantId: ids.tenant,
            stationId: ids.station,
            businessDayId: dayId,
            businessDate: date,
          },
          supervisorToken,
        )
      ).status,
    ).toBe(200);

    const runShift = async (templateId: string, opening: string, closing: string) => {
      const shiftId = randomUUID();
      const reconciliationId = randomUUID();
      const common = { tenantId: ids.tenant, stationId: ids.station, reconciliationId };
      const ok = async (input: Record<string, unknown>) => {
        const response = await post(input, supervisorToken);
        if (response.status !== 200) {
          throw new Error(
            `${String(input.commandType)} gave ${response.status}: ${await response.text()}`,
          );
        }
      };
      const litres = Number(closing) - Number(opening);
      const value = (litres * 1.5).toFixed(2);
      await ok({
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId: dayId,
        shiftId,
        expectedVersion: 0,
        shiftTemplateId: templateId,
      });
      await ok({
        ...common,
        commandType: 'CreateProductionReconciliation',
        businessDayId: dayId,
        shiftId,
        expectedVersion: 0,
      });
      await ok({
        ...common,
        commandType: 'SaveMeterReadings',
        expectedVersion: 0,
        readings: [
          {
            nozzleId: ids.nozzle,
            productId: ids.product,
            shiftId,
            openingReading: opening,
            closingReading: closing,
            sellingPriceId: ids.price,
          },
        ],
      });
      await ok({
        ...common,
        commandType: 'SavePaymentAllocations',
        expectedVersion: 1,
        payments: [{ method: 'CASH', amount: value }],
      });
      await ok({ ...common, commandType: 'SaveExpenses', expectedVersion: 2, expenses: [] });
      await ok({
        ...common,
        commandType: 'SaveCashDeclaration',
        expectedVersion: 3,
        countedCash: value,
      });
      await ok({
        ...common,
        commandType: 'SaveVarianceExplanations',
        expectedVersion: 4,
        explanations: {},
      });
      await ok({
        ...common,
        commandType: 'SetAttendants',
        expectedVersion: 5,
        attendantIds: [ids.attendantMembership],
      });
      await ok({ ...common, commandType: 'SubmitProductionReconciliation', expectedVersion: 6 });
      const shiftVersion = await client<{ version: number }[]>`
        select version from app.shifts where id = ${shiftId}`;
      await ok({
        commandType: 'CloseMeters',
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId: dayId,
        shiftId,
        expectedVersion: shiftVersion[0]!.version,
      });
      return shiftId;
    };

    const morning = await runShift(ids.morning, '1000', '1200');
    const afternoon = await runShift(ids.afternoon, '1200', '1500');

    const segments = await client<{ code: string; litres: string; start: string; end: string }[]>`
      select t.code, ms.litres::text as litres,
        to_char(s.planned_start_at at time zone 'Africa/Harare', 'HH24:MI') as start,
        to_char(s.planned_end_at at time zone 'Africa/Harare', 'HH24:MI') as end
      from app.meter_segments ms
      join app.shifts s on s.id = ms.shift_id
      join app.shift_templates t on t.id = s.shift_template_id
      where ms.shift_id in (${morning}, ${afternoon})
      order by s.planned_start_at`;
    expect(segments.map((row) => [row.code, Number(row.litres), row.start, row.end])).toEqual([
      ['AM', 200, '06:00', '14:00'],
      ['PM', 300, '14:00', '22:00'],
    ]);
  });
});
