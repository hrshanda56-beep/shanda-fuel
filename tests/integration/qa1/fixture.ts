import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { seedActiveStepUp } from '../auth-session-fixtures';

export type Qa1ActorName = 'admin' | 'supervisor' | 'finance' | 'attendant' | 'otherTenant';

export type Qa1ScenarioContext = {
  runId: string;
  label: string;
  businessDate: string;
  timezone: 'Africa/Harare';
  tenantId: string;
  otherTenantId: string;
  legalEntityId: string;
  otherLegalEntityId: string;
  stationId: string;
  outsideStationId: string;
  otherStationId: string;
  productId: string;
  pumpId: string;
  nozzleId: string;
  meterId: string;
  meterInstallationId: string;
  priceId: string;
  tankId: string;
  businessDayId: string;
  tillId: string;
  safeId: string;
  bankAccountId: string;
  actors: Record<
    Qa1ActorName,
    { actorId: string; membershipId: string; sessionId: string; token: string }
  >;
};

function id(): string {
  return randomUUID();
}

function token(label: string, actor: Qa1ActorName): string {
  return `qa1-${label}-${actor}-${randomUUID()}`;
}

/**
 * Seeds only tenant, identity, station, product, configuration, and other
 * reference data. Every economic movement is created later through a public
 * production command route.
 */
export async function createQa1ScenarioContext(
  client: Sql,
  label: string,
): Promise<Qa1ScenarioContext> {
  const runId = randomUUID();
  const businessDate = '2026-09-26';
  const tenantId = id();
  const otherTenantId = id();
  const legalEntityId = id();
  const otherLegalEntityId = id();
  const stationId = id();
  const outsideStationId = id();
  const otherStationId = id();
  const productId = id();
  const pumpId = id();
  const nozzleId = id();
  const meterId = id();
  const meterInstallationId = id();
  const priceId = id();
  const tankId = id();
  const businessDayId = id();
  const tillId = id();
  const safeId = id();
  const bankAccountId = id();

  const actors = {
    admin: { actorId: id(), membershipId: id(), sessionId: id(), token: token(label, 'admin') },
    supervisor: {
      actorId: id(),
      membershipId: id(),
      sessionId: id(),
      token: token(label, 'supervisor'),
    },
    finance: { actorId: id(), membershipId: id(), sessionId: id(), token: token(label, 'finance') },
    attendant: {
      actorId: id(),
      membershipId: id(),
      sessionId: id(),
      token: token(label, 'attendant'),
    },
    otherTenant: {
      actorId: id(),
      membershipId: id(),
      sessionId: id(),
      token: token(label, 'otherTenant'),
    },
  } satisfies Record<
    Qa1ActorName,
    { actorId: string; membershipId: string; sessionId: string; token: string }
  >;

  await client.unsafe(`
    insert into app.tenants (id, name, slug) values
      ('${tenantId}', 'QA1 ${label}', 'qa1-${runId}'),
      ('${otherTenantId}', 'QA1 Other ${label}', 'qa1-other-${runId}')
    on conflict (id) do nothing;

    insert into auth."user" (id, name, email) values
      ('${actors.admin.actorId}', 'QA1 Administrator', '${runId}-admin@example.test'),
      ('${actors.supervisor.actorId}', 'QA1 Supervisor', '${runId}-supervisor@example.test'),
      ('${actors.finance.actorId}', 'QA1 Finance', '${runId}-finance@example.test'),
      ('${actors.attendant.actorId}', 'QA1 Attendant', '${runId}-attendant@example.test'),
      ('${actors.otherTenant.actorId}', 'QA1 Other Tenant', '${runId}-other@example.test')
    on conflict (id) do nothing;

    insert into app.memberships (id, tenant_id, identity_id, status) values
      ('${actors.admin.membershipId}', '${tenantId}', '${actors.admin.actorId}', 'ACTIVE'),
      ('${actors.supervisor.membershipId}', '${tenantId}', '${actors.supervisor.actorId}', 'ACTIVE'),
      ('${actors.finance.membershipId}', '${tenantId}', '${actors.finance.actorId}', 'ACTIVE'),
      ('${actors.attendant.membershipId}', '${tenantId}', '${actors.attendant.actorId}', 'ACTIVE'),
      ('${actors.otherTenant.membershipId}', '${otherTenantId}', '${actors.otherTenant.actorId}', 'ACTIVE')
    on conflict (id) do nothing;

    insert into app.legal_entities (id, tenant_id, legal_name) values
      ('${legalEntityId}', '${tenantId}', 'QA1 Legal Entity'),
      ('${otherLegalEntityId}', '${otherTenantId}', 'QA1 Other Legal Entity')
    on conflict (id) do nothing;

    insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone) values
      ('${stationId}', '${tenantId}', '${legalEntityId}', 'QA1-MAIN-${runId.slice(0, 8)}', 'QA1 Main', 'ACTIVE', 'Africa/Harare'),
      ('${outsideStationId}', '${tenantId}', '${legalEntityId}', 'QA1-OUT-${runId.slice(0, 8)}', 'QA1 Outside', 'ACTIVE', 'Africa/Harare'),
      ('${otherStationId}', '${otherTenantId}', '${otherLegalEntityId}', 'QA1-OTHER-${runId.slice(0, 8)}', 'QA1 Other', 'ACTIVE', 'Africa/Harare')
    on conflict (id) do nothing;

    insert into app.membership_role_assignments
      (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
    values
      ('${tenantId}', '${actors.admin.membershipId}', 'ADMINISTRATOR', 'TENANT', null, null),
      ('${tenantId}', '${actors.admin.membershipId}', 'ADMINISTRATOR', 'STATION', '${legalEntityId}', '${stationId}'),
      ('${tenantId}', '${actors.supervisor.membershipId}', 'SUPERVISOR', 'STATION', '${legalEntityId}', '${stationId}'),
      ('${tenantId}', '${actors.finance.membershipId}', 'FINANCE', 'TENANT', null, null),
      ('${tenantId}', '${actors.finance.membershipId}', 'FINANCE', 'LEGAL_ENTITY', '${legalEntityId}', null),
      ('${tenantId}', '${actors.finance.membershipId}', 'FINANCE', 'STATION', '${legalEntityId}', '${stationId}'),
      ('${tenantId}', '${actors.attendant.membershipId}', 'ATTENDANT', 'STATION', '${legalEntityId}', '${stationId}'),
      ('${otherTenantId}', '${actors.otherTenant.membershipId}', 'ADMINISTRATOR', 'TENANT', null, null),
      ('${otherTenantId}', '${actors.otherTenant.membershipId}', 'ADMINISTRATOR', 'STATION', '${otherLegalEntityId}', '${otherStationId}')
    on conflict do nothing;

    insert into app.products (id, tenant_id, code, name, status)
    values ('${productId}', '${tenantId}', 'QA1-DIESEL-${runId.slice(0, 8)}', 'QA1 Diesel', 'ACTIVE')
    on conflict (id) do nothing;

    insert into app.pumps (id, tenant_id, station_id, number, name, status)
    values ('${pumpId}', '${tenantId}', '${stationId}', '1', 'QA1 Pump', 'ACTIVE')
    on conflict (id) do nothing;

    insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
    values ('${nozzleId}', '${tenantId}', '${stationId}', '${pumpId}', '1', '${productId}', 'ACTIVE')
    on conflict (id) do nothing;

    insert into app.meters (id, tenant_id, serial_number, status)
    values ('${meterId}', '${tenantId}', 'QA1-METER-${runId.slice(0, 8)}', 'ACTIVE')
    on conflict (id) do nothing;

    insert into app.meter_installations
      (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
    values ('${meterInstallationId}', '${tenantId}', '${stationId}', '${nozzleId}', '${meterId}', '2020-01-01T00:00:00Z', '${actors.admin.membershipId}')
    on conflict (id) do nothing;

    insert into app.selling_prices
      (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
    values ('${priceId}', '${tenantId}', '${stationId}', '${productId}', '2020-01-01T00:00:00Z', 2.500000, 'DRAFT', '${actors.admin.membershipId}')
    on conflict (id) do nothing;
    update app.selling_prices set state='PENDING_APPROVAL'
      where tenant_id='${tenantId}' and id='${priceId}' and state='DRAFT';
    update app.selling_prices set state='APPROVED', approved_by='${actors.admin.membershipId}', approved_at='2026-09-26T05:00:00Z'
      where tenant_id='${tenantId}' and id='${priceId}' and state='PENDING_APPROVAL';
    update app.selling_prices set state='PENDING_STATION_ACTIVATION'
      where tenant_id='${tenantId}' and id='${priceId}' and state='APPROVED';
    update app.selling_prices set state='BOUNDARIES_IN_PROGRESS'
      where tenant_id='${tenantId}' and id='${priceId}' and state='PENDING_STATION_ACTIVATION';
    update app.selling_prices set state='ACTIVE', activated_at='2026-09-26T05:00:01Z'
      where tenant_id='${tenantId}' and id='${priceId}' and state='BOUNDARIES_IN_PROGRESS';

    insert into app.tanks
      (id, tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres, acceptable_variance_litres, status, created_by, updated_by)
    values ('${tankId}', '${tenantId}', '${stationId}', 'QA1-TANK-${runId.slice(0, 8)}', '${productId}', 10000, 500, 10, 'ACTIVE', '${actors.admin.membershipId}', '${actors.admin.membershipId}')
    on conflict (id) do nothing;

    insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
    values ('${businessDayId}', '${tenantId}', '${stationId}', '${businessDate}', 'NOT_STARTED')
    on conflict (id) do nothing;

    insert into app.cash_locations (id, tenant_id, station_id, code, name, location_type)
    values
      ('${tillId}', '${tenantId}', '${stationId}', 'QA1-TILL-${runId.slice(0, 8)}', 'QA1 Till', 'STATION_TILL'),
      ('${safeId}', '${tenantId}', '${stationId}', 'QA1-SAFE-${runId.slice(0, 8)}', 'QA1 Safe', 'STATION_SAFE')
    on conflict (id) do nothing;

    insert into app.bank_accounts
      (id, tenant_id, legal_entity_id, name, bank_name, account_reference_masked)
    values ('${bankAccountId}', '${tenantId}', '${legalEntityId}', 'QA1 Operating Account ${runId.slice(0, 8)}', 'QA1 Test Bank', '****QA1')
    on conflict (id) do nothing;

    insert into auth.session
      (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
    values
      ('${actors.admin.sessionId}', '2030-01-01T00:00:00Z', '${actors.admin.token}', '${actors.admin.actorId}', true, '2026-09-26T05:00:00Z'),
      ('${actors.supervisor.sessionId}', '2030-01-01T00:00:00Z', '${actors.supervisor.token}', '${actors.supervisor.actorId}', true, '2026-09-26T05:00:00Z'),
      ('${actors.finance.sessionId}', '2030-01-01T00:00:00Z', '${actors.finance.token}', '${actors.finance.actorId}', true, '2026-09-26T05:00:00Z'),
      ('${actors.attendant.sessionId}', '2030-01-01T00:00:00Z', '${actors.attendant.token}', '${actors.attendant.actorId}', false, null),
      ('${actors.otherTenant.sessionId}', '2030-01-01T00:00:00Z', '${actors.otherTenant.token}', '${actors.otherTenant.actorId}', true, '2026-09-26T05:00:00Z')
    on conflict (id) do nothing;
  `);

  await seedActiveStepUp(client, actors.admin.sessionId);
  await seedActiveStepUp(client, actors.supervisor.sessionId);
  await seedActiveStepUp(client, actors.finance.sessionId);

  return {
    runId,
    label,
    businessDate,
    timezone: 'Africa/Harare',
    tenantId,
    otherTenantId,
    legalEntityId,
    otherLegalEntityId,
    stationId,
    outsideStationId,
    otherStationId,
    productId,
    pumpId,
    nozzleId,
    meterId,
    meterInstallationId,
    priceId,
    tankId,
    businessDayId,
    tillId,
    safeId,
    bankAccountId,
    actors,
  };
}

export const QA1_TIMES = {
  opening: '2026-09-26T05:00:00.000Z',
  segmentOpen: '2026-09-26T06:00:00.000Z',
  deliveryBoundary: '2026-09-26T07:00:00.000Z',
  segmentClose: '2026-09-26T08:00:00.000Z',
  blockedSegmentOpen: '2026-09-26T08:00:00.000Z',
  blockedSegmentClose: '2026-09-26T09:00:00.000Z',
  lateDelivery: '2026-09-26T06:30:00.000Z',
  futureSegmentOpen: '2026-09-26T09:00:00.000Z',
  futureSegmentClose: '2026-09-26T10:00:00.000Z',
} as const;
