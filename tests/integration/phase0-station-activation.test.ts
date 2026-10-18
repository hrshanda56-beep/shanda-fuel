import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as forecourtCommandPost } from '../../src/app/api/forecourt/commands/route';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for station activation PostgreSQL tests.');
}

const ids = {
  tenant: randomUUID(),
  otherTenant: randomUUID(),
  legalEntity: randomUUID(),
  otherLegalEntity: randomUUID(),
  owner: randomUUID(),
  ownerMembership: randomUUID(),
  ownerSession: randomUUID(),
  supervisor: randomUUID(),
  supervisorMembership: randomUUID(),
  supervisorSession: randomUUID(),
  onboarding: randomUUID(),
  incomplete: randomUUID(),
  denied: randomUUID(),
  concurrent: randomUUID(),
  otherStation: randomUUID(),
  raceEditStation: randomUUID(),
  dayTemplate: randomUUID(),
  nightTemplate: randomUUID(),
  incompleteTemplate: randomUUID(),
  concurrentDayTemplate: randomUUID(),
  concurrentNightTemplate: randomUUID(),
  raceEditDayTemplate: randomUUID(),
  raceEditNightTemplate: randomUUID(),
};

const ownerToken = `phase0-owner-${randomUUID()}`;
const supervisorToken = `phase0-supervisor-${randomUUID()}`;
let client: Sql;

async function postCommand(input: Record<string, unknown>, key: string, token = ownerToken) {
  const signedToken = token;
  return forecourtCommandPost(
    new Request('http://127.0.0.1:3000/api/forecourt/commands', {
      method: 'POST',
      headers: {
        ...clerkHeaders(signedToken),
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(input),
    }),
  );
}

async function configureShift(
  stationId: string,
  shiftTemplateId: string,
  shift: { code: string; name: string; startTime: string },
): Promise<void> {
  const response = await postCommand(
    {
      commandType: 'DefineShiftTemplate',
      tenantId: ids.tenant,
      stationId,
      shiftTemplateId,
      expectedVersion: 0,
      ...shift,
      durationMinutes: 720,
      active: true,
    },
    `phase0-config-${stationId}-${shiftTemplateId}`,
  );
  expect(response.status, await response.clone().text()).toBe(200);
}

async function activate(stationId: string, idempotencyKey: string, token = ownerToken) {
  return postCommand(
    { commandType: 'ActivateStation', tenantId: ids.tenant, stationId },
    idempotencyKey,
    token,
  );
}

describe('Phase 0 station activation in PostgreSQL', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';

    process.env.AUDIT_SIGNING_KEY_ID ??= 'phase0-activation-test-key';
    process.env.AUDIT_SIGNING_KEY ??= 'phase0-activation-test-audit-secret';
    client = postgres(databaseUrl!, { max: 4, prepare: false });

    await client`
      insert into app.tenants (id, name, slug) values
        (${ids.tenant}, 'Phase 0 Activation Tenant', ${`phase0-${ids.tenant}`}),
        (${ids.otherTenant}, 'Phase 0 Other Tenant', ${`phase0-${ids.otherTenant}`})
    `;
    await client`
      insert into app.users (id, name, email) values
        (${ids.owner}, 'Phase 0 Owner', ${`phase0-owner-${ids.owner}@example.test`}),
        (${ids.supervisor}, 'Phase 0 Supervisor', ${`phase0-supervisor-${ids.supervisor}@example.test`})
    `;
    await client`
      insert into app.memberships (id, tenant_id, identity_id, status) values
        (${ids.ownerMembership}, ${ids.tenant}, ${ids.owner}, 'ACTIVE'),
        (${ids.supervisorMembership}, ${ids.tenant}, ${ids.supervisor}, 'ACTIVE')
    `;
    await client`
      insert into app.legal_entities (id, tenant_id, legal_name) values
        (${ids.legalEntity}, ${ids.tenant}, 'Phase 0 Legal Entity'),
        (${ids.otherLegalEntity}, ${ids.otherTenant}, 'Other Legal Entity')
    `;
    await client`
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        (${ids.onboarding}, ${ids.tenant}, ${ids.legalEntity}, 'P0-ONB', 'Activation Station', 'ONBOARDING', 'Africa/Harare'),
        (${ids.incomplete}, ${ids.tenant}, ${ids.legalEntity}, 'P0-INC', 'Incomplete Schedule Station', 'ONBOARDING', 'Africa/Harare'),
        (${ids.denied}, ${ids.tenant}, ${ids.legalEntity}, 'P0-DEN', 'Denied Station', 'ONBOARDING', 'Africa/Harare'),
        (${ids.concurrent}, ${ids.tenant}, ${ids.legalEntity}, 'P0-CON', 'Concurrent Station', 'ONBOARDING', 'Africa/Harare'),
        (${ids.otherStation}, ${ids.otherTenant}, ${ids.otherLegalEntity}, 'P0-OTH', 'Other Tenant Station', 'ONBOARDING', 'Africa/Harare')
    `;
    await client`
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        (${ids.tenant}, ${ids.ownerMembership}, 'OWNER', 'STATION', ${ids.legalEntity}, ${ids.onboarding}),
        (${ids.tenant}, ${ids.ownerMembership}, 'OWNER', 'STATION', ${ids.legalEntity}, ${ids.incomplete}),
        (${ids.tenant}, ${ids.ownerMembership}, 'OWNER', 'STATION', ${ids.legalEntity}, ${ids.denied}),
        (${ids.tenant}, ${ids.ownerMembership}, 'OWNER', 'STATION', ${ids.legalEntity}, ${ids.concurrent}),
        (${ids.tenant}, ${ids.supervisorMembership}, 'SUPERVISOR', 'STATION', ${ids.legalEntity}, ${ids.denied})
    `;
    await seedClerkSession(client, ids.ownerSession, ownerToken, ids.owner);
    await seedClerkSession(client, ids.supervisorSession, supervisorToken, ids.supervisor);
    await seedActiveStepUp(client, ids.ownerSession, ids.tenant);
    await seedActiveStepUp(client, ids.supervisorSession, ids.tenant);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('activates only after persisting the exact day/night schedule and preserves the overnight boundary', async () => {
    await configureShift(ids.onboarding, ids.dayTemplate, {
      code: 'DAY',
      name: 'Day Shift',
      startTime: '06:00',
    });
    await configureShift(ids.onboarding, ids.nightTemplate, {
      code: 'NIGHT',
      name: 'Night Shift',
      startTime: '18:00',
    });

    const response = await activate(ids.onboarding, `phase0-activate-${ids.onboarding}`);
    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      stationId: ids.onboarding,
      status: 'ACTIVE',
    });

    const editedSchedule = await postCommand(
      {
        commandType: 'DefineShiftTemplate',
        tenantId: ids.tenant,
        stationId: ids.onboarding,
        shiftTemplateId: ids.dayTemplate,
        expectedVersion: 0,
        code: 'DAY',
        name: 'Day Shift',
        startTime: '07:00',
        durationMinutes: 720,
        active: true,
      },
      `phase0-edit-activated-schedule-${ids.onboarding}`,
    );
    expect(editedSchedule.status).toBe(409);

    const disabledSchedule = await postCommand(
      {
        commandType: 'DefineShiftTemplate',
        tenantId: ids.tenant,
        stationId: ids.onboarding,
        shiftTemplateId: ids.nightTemplate,
        expectedVersion: 0,
        code: 'NIGHT',
        name: 'Night Shift',
        startTime: '18:00',
        durationMinutes: 720,
        active: false,
      },
      `phase0-disable-activated-schedule-${ids.onboarding}`,
    );
    expect(disabledSchedule.status).toBe(409);

    const station = await client<{ status: string; timezone: string }[]>`
      select status, timezone from app.stations where tenant_id = ${ids.tenant} and id = ${ids.onboarding}
    `;
    expect(station).toEqual([{ status: 'ACTIVE', timezone: 'Africa/Harare' }]);

    const templates = await client<
      {
        code: string;
        name: string;
        start_time: string;
        duration_minutes: number;
        active: boolean;
      }[]
    >`
      select code, name, to_char(start_time, 'HH24:MI') as start_time, duration_minutes, active
      from app.shift_templates where tenant_id = ${ids.tenant} and station_id = ${ids.onboarding}
      order by start_time
    `;
    expect(templates).toEqual([
      { code: 'DAY', name: 'Day Shift', start_time: '06:00', duration_minutes: 720, active: true },
      {
        code: 'NIGHT',
        name: 'Night Shift',
        start_time: '18:00',
        duration_minutes: 720,
        active: true,
      },
    ]);

    const opened = await postCommand(
      {
        commandType: 'OpenBusinessDay',
        tenantId: ids.tenant,
        stationId: ids.onboarding,
        businessDayId: randomUUID(),
        expectedVersion: 0,
      },
      `phase0-open-${ids.onboarding}`,
    );
    expect(opened.status, await opened.clone().text()).toBe(200);
    const { businessDayId, businessDate } = (await opened.json()) as {
      businessDayId: string;
      businessDate: string;
    };
    const unscheduled = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.onboarding,
        businessDayId,
        shiftId: randomUUID(),
        expectedVersion: 0,
        plannedStartAt: `${businessDate}T16:00:00.000Z`,
        plannedEndAt: `${businessDate}T17:00:00.000Z`,
      },
      `phase0-unscheduled-active-shift-${ids.onboarding}`,
    );
    expect(unscheduled.status).toBe(400);

    const shiftId = randomUUID();
    const night = await postCommand(
      {
        commandType: 'StartShift',
        tenantId: ids.tenant,
        stationId: ids.onboarding,
        businessDayId,
        shiftId,
        expectedVersion: 0,
        plannedStartAt: `${businessDate}T16:00:00.000Z`,
        shiftTemplateId: ids.nightTemplate,
      },
      `phase0-night-${shiftId}`,
    );
    expect(night.status, await night.clone().text()).toBe(200);
    const interval = await client<{ start_local: string; end_local: string }[]>`
      select to_char(planned_start_at at time zone 'Africa/Harare', 'YYYY-MM-DD HH24:MI') as start_local,
        to_char(planned_end_at at time zone 'Africa/Harare', 'YYYY-MM-DD HH24:MI') as end_local
      from app.shifts where tenant_id = ${ids.tenant} and station_id = ${ids.onboarding} and id = ${shiftId}
    `;
    const followingDate = new Date(`${businessDate}T12:00:00Z`);
    followingDate.setUTCDate(followingDate.getUTCDate() + 1);
    expect(interval).toEqual([
      {
        start_local: `${businessDate} 18:00`,
        end_local: `${followingDate.toISOString().slice(0, 10)} 06:00`,
      },
    ]);
    const preservedSchedule = await client<{ start_time: string; active: boolean }[]>`
      select to_char(start_time, 'HH24:MI') as start_time, active
      from app.shift_templates
      where tenant_id = ${ids.tenant} and station_id = ${ids.onboarding}
      order by start_time
    `;
    expect(preservedSchedule).toEqual([
      { start_time: '06:00', active: true },
      { start_time: '18:00', active: true },
    ]);

    const audit = await client<{ count: number }[]>`
      select count(*)::int as count from platform.security_events
      where tenant_id = ${ids.tenant} and actor_id = ${ids.owner}
        and event_code = 'FORECOURT.ActivateStation' and details->>'subjectId' = ${ids.onboarding}
    `;
    expect(audit[0]?.count).toBe(1);

    await client`
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone)
      values (${ids.raceEditStation}, ${ids.tenant}, ${ids.legalEntity}, 'P0-EDIT-RACE', 'Activation Edit Race Station', 'ONBOARDING', 'Africa/Harare')
    `;
    await client`
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values (${ids.tenant}, ${ids.ownerMembership}, 'OWNER', 'STATION', ${ids.legalEntity}, ${ids.raceEditStation})
    `;
    await configureShift(ids.raceEditStation, ids.raceEditDayTemplate, {
      code: 'DAY',
      name: 'Day Shift',
      startTime: '06:00',
    });
    await configureShift(ids.raceEditStation, ids.raceEditNightTemplate, {
      code: 'NIGHT',
      name: 'Night Shift',
      startTime: '18:00',
    });

    let activation: Promise<Response> | undefined;
    await client.begin(async (transaction) => {
      await transaction`
        select id from app.stations
        where tenant_id = ${ids.tenant} and id = ${ids.raceEditStation}
        for update
      `;
      await transaction`
        update app.shift_templates set start_time = '07:00'::time
        where tenant_id = ${ids.tenant} and station_id = ${ids.raceEditStation}
          and id = ${ids.raceEditDayTemplate}
      `;
      activation = activate(ids.raceEditStation, `phase0-edit-race-${ids.raceEditStation}`);
      let waiting = 0;
      const deadline = Date.now() + 2_000;
      while (waiting === 0 && Date.now() < deadline) {
        const rows = await client<{ count: number }[]>`
          select count(*)::int as count from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and state = 'active' and query like '%for update of station%'
        `;
        waiting = rows[0]?.count ?? 0;
        if (waiting === 0) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBeGreaterThan(0);
    });

    const editRace = await activation!;
    expect(editRace.status, await editRace.clone().text()).toBe(409);
    const editRaceState = await client<{ status: string; start_time: string }[]>`
      select station.status, to_char(template.start_time, 'HH24:MI') as start_time
      from app.stations station
      join app.shift_templates template on template.tenant_id = station.tenant_id
        and template.station_id = station.id and template.id = ${ids.raceEditDayTemplate}
      where station.tenant_id = ${ids.tenant} and station.id = ${ids.raceEditStation}
    `;
    expect(editRaceState).toEqual([{ status: 'ONBOARDING', start_time: '07:00' }]);
  });

  it('denies wrong-tenant and missing station.manage requests and rejects an invalid source state', async () => {
    const wrongTenant = await postCommand(
      { commandType: 'ActivateStation', tenantId: ids.otherTenant, stationId: ids.onboarding },
      `phase0-wrong-tenant-${ids.onboarding}`,
    );
    expect(wrongTenant.status).toBe(403);

    const missingPermission = await activate(
      ids.denied,
      `phase0-no-station-manage-${ids.denied}`,
      supervisorToken,
    );
    expect(missingPermission.status).toBe(403);

    const invalidState = await activate(ids.onboarding, `phase0-duplicate-${ids.onboarding}`);
    expect(invalidState.status).toBe(409);
  });

  it('fails closed when the schedule is missing or incomplete', async () => {
    const missing = await activate(ids.incomplete, `phase0-no-schedule-${ids.incomplete}`);
    expect(missing.status).toBe(409);

    await configureShift(ids.incomplete, ids.incompleteTemplate, {
      code: 'DAY',
      name: 'Day Shift',
      startTime: '06:00',
    });
    const incomplete = await activate(ids.incomplete, `phase0-incomplete-${ids.incomplete}`);
    expect(incomplete.status).toBe(409);
    const status = await client<{ status: string }[]>`
      select status from app.stations where tenant_id = ${ids.tenant} and id = ${ids.incomplete}
    `;
    expect(status[0]?.status).toBe('ONBOARDING');
  });

  it('replays the same idempotency key once and serializes competing activations', async () => {
    await configureShift(ids.concurrent, ids.concurrentDayTemplate, {
      code: 'DAY',
      name: 'Day Shift',
      startTime: '06:00',
    });
    await configureShift(ids.concurrent, ids.concurrentNightTemplate, {
      code: 'NIGHT',
      name: 'Night Shift',
      startTime: '18:00',
    });

    const replayKey = `phase0-replay-${ids.concurrent}`;
    const replayFirst = await activate(ids.concurrent, replayKey);
    expect(replayFirst.status).toBe(200);
    const replaySecond = await activate(ids.concurrent, replayKey);
    expect(replaySecond.status).toBe(200);

    const concurrentStation = randomUUID();
    await client`
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone)
      values (${concurrentStation}, ${ids.tenant}, ${ids.legalEntity}, 'P0-RACE', 'Concurrent Race Station', 'ONBOARDING', 'Africa/Harare')
    `;
    await client`
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values (${ids.tenant}, ${ids.ownerMembership}, 'OWNER', 'STATION', ${ids.legalEntity}, ${concurrentStation})
    `;
    await configureShift(concurrentStation, randomUUID(), {
      code: 'DAY',
      name: 'Day Shift',
      startTime: '06:00',
    });
    await configureShift(concurrentStation, randomUUID(), {
      code: 'NIGHT',
      name: 'Night Shift',
      startTime: '18:00',
    });
    const race = await Promise.all([
      activate(concurrentStation, `phase0-race-a-${concurrentStation}`),
      activate(concurrentStation, `phase0-race-b-${concurrentStation}`),
    ]);
    expect(race.map((response) => response.status).sort()).toEqual([200, 409]);
    const finalState = await client<{ status: string }[]>`
      select status from app.stations where tenant_id = ${ids.tenant} and id = ${concurrentStation}
    `;
    expect(finalState).toEqual([{ status: 'ACTIVE' }]);
    const audit = await client<{ count: number }[]>`
      select count(*)::int as count from platform.security_events
      where tenant_id = ${ids.tenant} and event_code = 'FORECOURT.ActivateStation'
        and details->>'subjectId' = ${concurrentStation}
    `;
    expect(audit[0]?.count).toBe(1);
  });

  it('leaves station RLS enabled, forced, and tenant-scoped', async () => {
    const policy = await client<
      {
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        tablename: string;
        policyname: string;
        qual: string;
        with_check: string;
      }[]
    >`
      select c.relrowsecurity, c.relforcerowsecurity, p.policyname, p.qual, p.with_check
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
      where n.nspname = 'app' and c.relname in ('stations', 'shift_templates')
        and p.policyname = 'tenant_context'
      order by c.relname
    `;
    expect(policy).toHaveLength(2);
    for (const row of policy) {
      expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      expect(row.qual).toContain('current_tenant_id');
      expect(row.with_check).toContain('current_tenant_id');
    }
  });
});
