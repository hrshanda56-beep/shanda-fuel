import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { Sql } from 'postgres';

export const ids = {
  tenant: 'a5e00000-0000-4000-8000-000000000001',
  legal: 'a5e00000-0000-4000-8000-000000000011',
  station: 'a5e00000-0000-4000-8000-000000000021',
  attendantActor: 'a5e00000-0000-4000-8000-000000000033',
  attendantMembership: 'a5e00000-0000-4000-8000-000000000043',
  supervisorActor: 'a5e00000-0000-4000-8000-000000000031',
  supervisorMembership: 'a5e00000-0000-4000-8000-000000000041',
  supervisorSession: 'a5e00000-0000-4000-8000-000000000051',
  managerActor: 'a5e00000-0000-4000-8000-000000000032',
  managerMembership: 'a5e00000-0000-4000-8000-000000000042',
  managerSession: 'a5e00000-0000-4000-8000-000000000052',
  product: 'a5e00000-0000-4000-8000-000000000061',
  pump: 'a5e00000-0000-4000-8000-000000000071',
  nozzle: 'a5e00000-0000-4000-8000-000000000081',
  meter: 'a5e00000-0000-4000-8000-000000000091',
  installation: 'a5e00000-0000-4000-8000-000000000101',
  price: 'a5e00000-0000-4000-8000-000000000111',
  day: 'a5e00000-0000-4000-8000-000000000121',
  shift: 'a5e00000-0000-4000-8000-000000000131',
  retryShift: 'a5e00000-0000-4000-8000-000000000132',
  retryShiftTwo: 'a5e00000-0000-4000-8000-000000000133',
  retryShiftThree: 'a5e00000-0000-4000-8000-000000000134',
  a11RetryShift: 'a5e00000-0000-4000-8000-000000000135',
  a11RetryShiftTwo: 'a5e00000-0000-4000-8000-000000000136',
  a11RetryShiftThree: 'a5e00000-0000-4000-8000-000000000137',
  controlRoomShift: 'a5e00000-0000-4000-8000-000000000138',
  tank: 'a5e00000-0000-4000-8000-000000000141',
  openingSource: 'a5e00000-0000-4000-8000-000000000151',
  openingCostEvent: 'a5e00000-0000-4000-8000-000000000152',
};

export const supervisorToken = 'a5e-supervisor-session-token';
export const managerToken = 'a5e-manager-session-token';

/** Synthetic fixtures for disposable local PostgreSQL tests and rehearsals only. */
export async function seedOwnerWorkflow(client: Sql) {
  const ownerPassword = await hashPassword('synthetic-e2e-owner-password');
  await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'A5 E2E Tenant', 'a5-e2e-tenant')
        on conflict (id) do nothing;
      insert into auth."user" (id, name, email) values
        ('${ids.supervisorActor}', 'A5 E2E Supervisor', 'a5e-supervisor@example.test'),
        ('${ids.managerActor}', 'A5 E2E Owner', 'a5e-manager@example.test'),
        ('${ids.attendantActor}', 'A5 E2E Attendant', 'a5e-attendant@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisorActor}', 'ACTIVE'),
        ('${ids.managerMembership}', '${ids.tenant}', '${ids.managerActor}', 'ACTIVE'),
        ('${ids.attendantMembership}', '${ids.tenant}', '${ids.attendantActor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'A5 E2E Legal') on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A5E2E', 'A5 E2E Station', 'ACTIVE', 'Africa/Harare')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values
        ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.attendantMembership}', 'ATTENDANT', 'STATION', '${ids.legal}', '${ids.station}'),
        ('${ids.tenant}', '${ids.managerMembership}', 'OWNER', 'TENANT', null, null)
        on conflict (id) do nothing;
      insert into app.products (id, tenant_id, code, name)
        values ('${ids.product}', '${ids.tenant}', 'A5E2E-DIESEL', 'A5 E2E Diesel') on conflict (id) do nothing;
      insert into app.pumps (id, tenant_id, station_id, number, status)
        values ('${ids.pump}', '${ids.tenant}', '${ids.station}', '1', 'ACTIVE') on conflict (id) do nothing;
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
        values ('${ids.nozzle}', '${ids.tenant}', '${ids.station}', '${ids.pump}', '1', '${ids.product}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.meters (id, tenant_id, serial_number)
        values ('${ids.meter}', '${ids.tenant}', 'A5E2E-METER-1') on conflict (id) do nothing;
      insert into app.meter_installations
        (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
      values
        ('${ids.installation}', '${ids.tenant}', '${ids.station}', '${ids.nozzle}', '${ids.meter}', '2020-01-01T00:00:00Z', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.selling_prices
        (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
      values
        ('${ids.price}', '${ids.tenant}', '${ids.station}', '${ids.product}', '2020-01-01T00:00:00Z', 1.500000, 'DRAFT', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      update app.selling_prices set state='PENDING_APPROVAL'
        where id='${ids.price}' and state='DRAFT';
      update app.selling_prices set state='APPROVED', approved_by='${ids.managerMembership}', approved_at=now()
        where id='${ids.price}' and state='PENDING_APPROVAL';
      update app.selling_prices set state='PENDING_STATION_ACTIVATION'
        where id='${ids.price}' and state='APPROVED';
      update app.selling_prices set state='BOUNDARIES_IN_PROGRESS'
        where id='${ids.price}' and state='PENDING_STATION_ACTIVATION';
      update app.selling_prices set state='ACTIVE', activated_at=now()
        where id='${ids.price}' and state='BOUNDARIES_IN_PROGRESS';
      insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values ('${ids.day}', '${ids.tenant}', '${ids.station}', '2026-09-23', 'NOT_STARTED')
        on conflict (id) do nothing;
      update app.station_business_days set state='OPEN', opened_at=coalesce(opened_at, now())
        where id='${ids.day}';
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
      values
        ('${ids.shift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T06:00:00Z', '2026-09-23T14:00:00Z', '2026-09-23')
        on conflict (id) do nothing;
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
      values
        ('${ids.retryShift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T14:00:00Z', '2026-09-23T22:00:00Z', '2026-09-23')
        on conflict (id) do nothing;
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
      values
        ('${ids.retryShiftTwo}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T22:00:00Z', '2026-09-24T06:00:00Z', '2026-09-23')
        on conflict (id) do nothing;
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
      values
        ('${ids.retryShiftThree}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T22:00:00Z', '2026-09-24T06:00:00Z', '2026-09-23')
        on conflict (id) do nothing;
      insert into app.shifts
        (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, business_date)
      values
        ('${ids.a11RetryShift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T06:00:00Z', '2026-09-23T14:00:00Z', '2026-09-23'),
        ('${ids.a11RetryShiftTwo}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T14:00:00Z', '2026-09-23T22:00:00Z', '2026-09-23'),
        ('${ids.a11RetryShiftThree}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T22:00:00Z', '2026-09-24T06:00:00Z', '2026-09-23'),
        ('${ids.controlRoomShift}', '${ids.tenant}', '${ids.station}', '${ids.day}', 'PLANNED', '2026-09-23T14:00:00Z', '2026-09-23T22:00:00Z', '2026-09-23')
        on conflict (id) do nothing;
      update app.shifts set state='OPEN', opened_at=coalesce(opened_at, now())
        where id in ('${ids.shift}', '${ids.retryShift}', '${ids.retryShiftTwo}', '${ids.retryShiftThree}', '${ids.a11RetryShift}', '${ids.a11RetryShiftTwo}', '${ids.a11RetryShiftThree}', '${ids.controlRoomShift}');
      insert into app.tanks
        (id, tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres, acceptable_variance_litres, status, created_by, updated_by)
      values
        ('${ids.tank}', '${ids.tenant}', '${ids.station}', 'A5E2E-D1', '${ids.product}', 10000, 500, 10, 'ACTIVE', '${ids.supervisorMembership}', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.inventory_movements
        (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
      values
        ('${ids.openingSource}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'OPENING_BALANCE', 3000, '2026-09-22T05:00:00Z', '2026-09-22', 'CUTOVER', '${ids.openingSource}', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into app.inventory_cost_events
        (id, tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id, effective_at, business_date, amount, currency, actor_membership_id)
      values
        ('${ids.openingCostEvent}', '${ids.tenant}', '${ids.station}', '${ids.tank}', '${ids.product}', 'OPENING_COST', 'CUTOVER', '${ids.openingSource}', '2026-09-22T05:00:00Z', '2026-09-22', 3000.0000, 'USD', '${ids.supervisorMembership}')
        on conflict (id) do nothing;
      insert into auth.session
        (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at,
         strong_authentication_expires_at, step_up_level, step_up_expires_at, step_up_tenant_id)
      values
        ('${ids.supervisorSession}', '2030-01-01T00:00:00Z', '${supervisorToken}', '${ids.supervisorActor}', true, now(), null, null, null, null),
        ('${ids.managerSession}', '2030-01-01T00:00:00Z', '${managerToken}', '${ids.managerActor}', true, now(), '2030-01-01T00:00:00Z', 1, '2030-01-01T00:00:00Z', '${ids.tenant}')
        on conflict (id) do update set
          expires_at=excluded.expires_at,
          strong_authentication_verified=excluded.strong_authentication_verified,
          strong_authenticated_at=excluded.strong_authenticated_at,
          strong_authentication_expires_at=excluded.strong_authentication_expires_at,
          step_up_level=excluded.step_up_level,
          step_up_expires_at=excluded.step_up_expires_at,
          step_up_tenant_id=excluded.step_up_tenant_id;
    `);
  await client`insert into auth.account(account_id,provider_id,user_id,password)
      values (${ids.managerActor},'credential',${ids.managerActor},${ownerPassword})
      on conflict(provider_id,account_id) do update set password=excluded.password`;
  await client`insert into auth.account(account_id,provider_id,user_id,password) values (${ids.supervisorActor},'credential',${ids.supervisorActor},${ownerPassword}) on conflict(provider_id,account_id) do update set password=excluded.password`;
  await client`update auth."user" set email_verified=true where id in (${ids.managerActor},${ids.supervisorActor})`;
}

export async function seedSecondNozzle(client: Sql) {
  const secondActor = randomUUID();
  const secondAttendant = randomUUID();
  const secondNozzle = randomUUID();
  const secondMeter = randomUUID();
  await client`insert into auth."user" (id,name,email) values (${secondActor},'Integration Attendant Two',${`attendant-${secondActor}@example.test`})`;
  await client`insert into app.memberships (id,tenant_id,identity_id,status) values (${secondAttendant},${ids.tenant},${secondActor},'ACTIVE')`;
  await client`insert into app.membership_role_assignments (tenant_id,membership_id,role_code,scope_type,legal_entity_id,station_id) values (${ids.tenant},${secondAttendant},'ATTENDANT','STATION',${ids.legal},${ids.station})`;
  await client`insert into app.nozzles (id,tenant_id,station_id,pump_id,number,product_id,status) values (${secondNozzle},${ids.tenant},${ids.station},${ids.pump},'2',${ids.product},'ACTIVE')`;
  await client`insert into app.meters (id,tenant_id,serial_number) values (${secondMeter},${ids.tenant},${`integration-${secondMeter}`})`;
  await client`insert into app.meter_installations (tenant_id,station_id,nozzle_id,meter_id,effective_from,installed_by) values (${ids.tenant},${ids.station},${secondNozzle},${secondMeter},'2020-01-01T00:00:00Z',${ids.supervisorMembership})`;

  return { secondAttendant, secondNozzle };
}
