import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { createTrustedTenantTransactionContext } from '../../src/platform/db/tenant-context';
import type { InventoryCommandContext } from '../../src/modules/inventory/application';
import {
  recordDeliveryCompartmentsCommand,
  recordDeliveryDriverConfirmationCommand,
  recordDeliveryWaterTestCommand,
  setWaterTestRequiredCommand,
} from '../../src/modules/deliveries/commands';
import { assertWaterTestAllowsConfirmation } from '../../src/modules/deliveries/persistence';
import { withTenantTransaction } from '../../src/platform/db/transaction';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for delivery detail integration tests.');
}

const ids = {
  tenantA: 'd1000000-0000-4000-8000-000000000001',
  legalA: 'd1000000-0000-4000-8000-000000000011',
  stationA: 'd1000000-0000-4000-8000-000000000021',
  actorA: 'd1000000-0000-4000-8000-000000000031',
  membershipA: 'd1000000-0000-4000-8000-000000000041',
  dieselA: 'd1000000-0000-4000-8000-000000000051',
  deliveryA: 'd1000000-0000-4000-8000-000000000071',
  confirmedA: 'd1000000-0000-4000-8000-000000000072',
  tenantB: 'd2000000-0000-4000-8000-000000000001',
  legalB: 'd2000000-0000-4000-8000-000000000011',
  stationB: 'd2000000-0000-4000-8000-000000000021',
  actorB: 'd2000000-0000-4000-8000-000000000031',
  membershipB: 'd2000000-0000-4000-8000-000000000041',
  dieselB: 'd2000000-0000-4000-8000-000000000051',
  deliveryB: 'd2000000-0000-4000-8000-000000000071',
};

let client: Sql;
const run = Date.now().toString(36);

function contextFor(side: 'A' | 'B'): InventoryCommandContext {
  const t = side === 'A' ? ids.tenantA : ids.tenantB;
  const legal = side === 'A' ? ids.legalA : ids.legalB;
  const station = side === 'A' ? ids.stationA : ids.stationB;
  const actor = side === 'A' ? ids.actorA : ids.actorB;
  const membership = side === 'A' ? ids.membershipA : ids.membershipB;
  const transaction = createTrustedTenantTransactionContext({
    tenantId: t,
    actorId: actor,
    membershipId: membership,
    legalEntityId: legal,
    stationId: station,
    requestId: `d${side === 'A' ? '1' : '2'}000000-0000-4000-8000-000000000099`,
  });
  const assignment = {
    tenantId: t,
    scopeType: 'STATION' as const,
    legalEntityId: legal,
    stationId: station,
    roleCode: 'ADMINISTRATOR' as const,
  };
  const authority = {
    actor: {
      identityId: actor,
      session: {
        sessionId: `d${side === 'A' ? '1' : '2'}000000-0000-4000-8000-000000000098`,
        userId: actor,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
        strongAuthenticatedAt: new Date('2026-09-23T00:00:00Z'),
        strongAuthenticationExpiresAt: new Date('2030-01-01T00:00:00Z'),
        strongAuthenticationVerified: true,
        stepUpTenantId: t,
      },
    },
    membership: {
      tenantId: t,
      membershipId: membership,
      identityId: actor,
      actorId: actor,
      status: 'ACTIVE' as const,
      roleAssignments: [assignment],
      temporaryGrants: [],
    },
    authorization: {
      userId: actor,
      membershipId: membership,
      tenantId: t,
      membershipActive: true,
      strongAuthenticationAt: new Date('2026-09-23T00:00:00Z'),
      strongAuthenticationExpiresAt: new Date('2030-01-01T00:00:00Z'),
      strongAuthenticationVerified: true,
      stepUpTenantId: t,
      roleAssignments: [assignment],
      temporaryGrants: [],
    },
    transaction,
  };
  return {
    authority,
    tenantId: t,
    legalEntityId: legal,
    stationId: station,
    stationTimezone: 'Africa/Harare',
    requestId: transaction.requestId!,
    scope: { tenantId: t, scopeType: 'STATION', legalEntityId: legal, stationId: station },
  };
}

const twoCompartments = (productId: string) => ({
  tenantId: ids.tenantA,
  stationId: ids.stationA,
  deliveryId: ids.deliveryA,
  compartments: [
    {
      compartmentNumber: 1,
      productId,
      noteLitres: '5000',
      receivedLitres: '4990.5',
      seals: [
        { sealNumber: 'S-1001', intact: true },
        { sealNumber: 'S-1002', intact: false },
      ],
    },
    {
      compartmentNumber: 2,
      productId,
      noteLitres: '5000',
      receivedLitres: '5000',
      seals: [{ sealNumber: 'S-2001', intact: true }],
    },
  ],
});

describe('delivery detail PostgreSQL persistence', () => {
  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-delivery-detail-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-delivery-detail-secret';
    client = postgres(databaseUrl, { max: 1, prepare: false });
    for (const [side, t, actor, membership, legal, station, product, delivery] of [
      [
        'A',
        ids.tenantA,
        ids.actorA,
        ids.membershipA,
        ids.legalA,
        ids.stationA,
        ids.dieselA,
        ids.deliveryA,
      ],
      [
        'B',
        ids.tenantB,
        ids.actorB,
        ids.membershipB,
        ids.legalB,
        ids.stationB,
        ids.dieselB,
        ids.deliveryB,
      ],
    ] as const) {
      await client.unsafe(`
        select set_config('app.tenant_id', '${t}', false);
        select set_config('app.actor_id', '${actor}', false);
        select set_config('app.membership_id', '${membership}', false);
        select set_config('app.station_id', '${station}', false);
        insert into app.tenants (id, name, slug) values ('${t}', 'Delivery ${side}', 'delivery-detail-${side.toLowerCase()}') on conflict (id) do nothing;
        insert into app.users (id, name, email) values ('${actor}', 'Delivery ${side}', 'delivery-detail-${side.toLowerCase()}@example.test') on conflict (id) do nothing;
        insert into app.memberships (id, tenant_id, identity_id, status) values ('${membership}', '${t}', '${actor}', 'ACTIVE') on conflict (id) do nothing;
        insert into app.legal_entities (id, tenant_id, legal_name) values ('${legal}', '${t}', 'Legal ${side}') on conflict (id) do nothing;
        insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values ('${station}', '${t}', '${legal}', 'DD${side}', 'Station ${side}', 'ACTIVE') on conflict (id) do nothing;
        insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
          values ('${t}', '${membership}', 'ADMINISTRATOR', 'STATION', '${legal}', '${station}') on conflict do nothing;
        insert into app.products (id, tenant_id, code, name) values ('${product}', '${t}', 'DIESEL', 'Diesel') on conflict (id) do nothing;
        insert into app.fuel_deliveries (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date,
          note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, recorded_by)
          values ('${delivery}', '${t}', '${station}', '${product}', 'DN-${side}-1', '2026-10-20T08:00:00Z', '2026-10-20',
          10000, 9990.5, -9.5, 'DRAFT', '${membership}') on conflict (id) do nothing;
      `);
    }
    await client.unsafe(`
      insert into app.fuel_deliveries (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date,
        note_quantity_litres, actual_quantity_litres, shortage_excess_litres, status, recorded_by, confirmed_by, confirmed_at)
        values ('${ids.confirmedA}', '${ids.tenantA}', '${ids.stationA}', '${ids.dieselA}', 'DN-A-2', '2026-10-21T08:00:00Z', '2026-10-21',
        1000, 1000, 0, 'CONFIRMED', '${ids.membershipA}', '${ids.membershipA}', now()) on conflict (id) do nothing;
    `);
  });

  afterAll(async () => {
    await client?.end();
  });

  it('records compartments with seals, flags the shortage and rewrites the set', async () => {
    const context = contextFor('A');
    const result = await recordDeliveryCompartmentsCommand(
      context,
      twoCompartments(ids.dieselA),
      `dd-compartments-1-${run}`,
    );
    expect(result).toMatchObject({
      receipt: 'PARTIAL',
      compartmentCount: 2,
      shortCompartments: 1,
      brokenSeals: 1,
      totalReceivedLitres: '9990.5',
    });
    const rows = await client`
      select c.compartment_number, c.received_litres::text as received, count(s.id)::int as seals
      from app.fuel_delivery_compartments c
      left join app.fuel_delivery_compartment_seals s on s.compartment_id = c.id
      where c.delivery_id = ${ids.deliveryA} group by c.id order by 1`;
    expect(rows.map((r) => [r.compartment_number, r.received, r.seals])).toEqual([
      [1, '4990.500', 2],
      [2, '5000.000', 1],
    ]);
    const audit = await client`
      select event_code from platform.security_events
      where tenant_id = ${ids.tenantA} and event_code = 'INVENTORY.DELIVERY_COMPARTMENTS_RECORDED'`;
    expect(audit.length).toBeGreaterThanOrEqual(1);

    // Same key and data replays; recording again with a new key replaces the set.
    await recordDeliveryCompartmentsCommand(
      context,
      twoCompartments(ids.dieselA),
      `dd-compartments-1-${run}`,
    );
    await recordDeliveryCompartmentsCommand(
      context,
      twoCompartments(ids.dieselA),
      `dd-compartments-2-${run}`,
    );
    const [countRow] = await client`
      select count(*)::int as n from app.fuel_delivery_compartments where delivery_id = ${ids.deliveryA}`;
    expect(countRow!.n).toBe(2);
  });

  it('rejects compartments that do not add up to the delivery', async () => {
    const payload = twoCompartments(ids.dieselA);
    payload.compartments[1]!.receivedLitres = '4000';
    await expect(
      recordDeliveryCompartmentsCommand(contextFor('A'), payload, `dd-compartments-bad-${run}`),
    ).rejects.toThrow(/litres received/);
  });

  it('records a water test and a driver confirmation, and lets the driver confirm later', async () => {
    const context = contextFor('A');
    await recordDeliveryWaterTestCommand(
      context,
      {
        tenantId: ids.tenantA,
        stationId: ids.stationA,
        deliveryId: ids.deliveryA,
        result: 'FAIL',
        waterReadingMm: '3.5',
      },
      `dd-water-1-${run}`,
    );
    await recordDeliveryWaterTestCommand(
      context,
      {
        tenantId: ids.tenantA,
        stationId: ids.stationA,
        deliveryId: ids.deliveryA,
        result: 'PASS',
        waterReadingMm: '0',
      },
      `dd-water-2-${run}`,
    );
    const water =
      await client`select result from app.fuel_delivery_water_tests where delivery_id = ${ids.deliveryA}`;
    expect(water.map((r) => r.result)).toEqual(['PASS']);

    await recordDeliveryDriverConfirmationCommand(
      context,
      {
        tenantId: ids.tenantA,
        stationId: ids.stationA,
        deliveryId: ids.confirmedA,
        driverName: 'T. Moyo',
        confirmed: true,
      },
      `dd-driver-confirmed-delivery-${run}`,
    );
    const driver =
      await client`select driver_name, confirmed, confirmed_at from app.fuel_delivery_driver_confirmations where delivery_id = ${ids.confirmedA}`;
    expect(driver[0]).toMatchObject({ driver_name: 'T. Moyo', confirmed: true });
    expect(driver[0]!.confirmed_at).not.toBeNull();
  });

  it('refuses to change compartments or the water test of a confirmed delivery', async () => {
    const context = contextFor('A');
    await expect(
      recordDeliveryWaterTestCommand(
        context,
        {
          tenantId: ids.tenantA,
          stationId: ids.stationA,
          deliveryId: ids.confirmedA,
          result: 'PASS',
        },
        `dd-water-confirmed-${run}`,
      ),
    ).rejects.toThrow(/already been confirmed/);
    // The database enforces the same rule even if the application is bypassed.
    await expect(
      client.unsafe(`insert into app.fuel_delivery_water_tests (tenant_id, station_id, delivery_id, result, tested_at, recorded_by)
        values ('${ids.tenantA}', '${ids.stationA}', '${ids.confirmedA}', 'PASS', now(), '${ids.membershipA}')`),
    ).rejects.toThrow(/only change while the delivery is a draft/);
  });

  it('blocks confirmation without a water test only when the owner turned the rule on', async () => {
    const context = contextFor('A');
    const scope = { tenantId: ids.tenantA, stationId: ids.stationA, deliveryId: ids.confirmedA };
    await withTenantTransaction(context.authority.transaction, (tx) =>
      assertWaterTestAllowsConfirmation(tx, scope),
    );
    await setWaterTestRequiredCommand(
      context,
      { tenantId: ids.tenantA, stationId: ids.stationA, required: true },
      `dd-rule-on-${run}`,
    );
    await expect(
      withTenantTransaction(context.authority.transaction, (tx) =>
        assertWaterTestAllowsConfirmation(tx, scope),
      ),
    ).rejects.toThrow(/water test/);
    await withTenantTransaction(context.authority.transaction, (tx) =>
      assertWaterTestAllowsConfirmation(tx, { ...scope, deliveryId: ids.deliveryA }),
    );
    await setWaterTestRequiredCommand(
      context,
      { tenantId: ids.tenantA, stationId: ids.stationA, required: false },
      `dd-rule-off-${run}`,
    );
  });

  it('isolates tenants: the other tenant sees and writes nothing', async () => {
    const runtime = postgres(databaseUrl, { max: 1, prepare: false });
    try {
      await runtime.unsafe('set role app_runtime');
      await runtime.unsafe(`
        select set_config('app.tenant_id', '${ids.tenantB}', false);
        select set_config('app.actor_id', '${ids.actorB}', false);
        select set_config('app.membership_id', '${ids.membershipB}', false);
        select set_config('app.station_id', '${ids.stationB}', false);`);
      for (const table of [
        'fuel_delivery_compartments',
        'fuel_delivery_compartment_seals',
        'fuel_delivery_water_tests',
        'fuel_delivery_driver_confirmations',
        'delivery_settings',
      ]) {
        const rows = await runtime.unsafe(
          `select 1 from app.${table} where tenant_id = '${ids.tenantA}'`,
        );
        expect(rows.length, table).toBe(0);
      }
      // Tenant B cannot attach a water test to tenant A's delivery, even naming tenant A.
      await expect(
        runtime.unsafe(`insert into app.fuel_delivery_water_tests (tenant_id, station_id, delivery_id, result, tested_at, recorded_by)
          values ('${ids.tenantA}', '${ids.stationA}', '${ids.deliveryA}', 'PASS', now(), '${ids.membershipA}')`),
      ).rejects.toThrow(/row-level security|violates|delivery not found/);
      // Nor can it attach one to its own tenant id but tenant A's delivery.
      await expect(
        runtime.unsafe(`insert into app.fuel_delivery_water_tests (tenant_id, station_id, delivery_id, result, tested_at, recorded_by)
          values ('${ids.tenantB}', '${ids.stationB}', '${ids.deliveryA}', 'PASS', now(), '${ids.membershipB}')`),
      ).rejects.toThrow(/foreign key|violates|delivery not found/);
      // Reading through the runtime role as tenant A's own context does see the rows.
      await runtime.unsafe(`
        select set_config('app.tenant_id', '${ids.tenantA}', false);
        select set_config('app.actor_id', '${ids.actorA}', false);
        select set_config('app.membership_id', '${ids.membershipA}', false);
        select set_config('app.station_id', '${ids.stationA}', false);`);
      const own = await runtime.unsafe(
        `select 1 from app.fuel_delivery_compartments where delivery_id = '${ids.deliveryA}'`,
      );
      expect(own.length).toBe(2);
    } finally {
      await runtime.end();
    }
  });

  it('shows compartment shortages to the delivery variance report data', async () => {
    await client.unsafe(`select set_config('app.tenant_id', '${ids.tenantA}', false)`);
    const rows = await client`
      select (select count(*)::int from app.fuel_delivery_compartments c
        where c.tenant_id = d.tenant_id and c.delivery_id = d.id and c.received_litres < c.note_litres) as short
      from app.fuel_deliveries d where d.id = ${ids.deliveryA}`;
    expect(rows[0]!.short).toBe(1);
  });
});
