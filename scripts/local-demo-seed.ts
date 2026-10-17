import { createHash } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';

/**
 * Seeds a disposable local database with a complete, station-scoped demo tenant.
 *
 * This is intentionally a script, not a migration. Production data must come
 * through onboarding/cutover workflows and must never depend on this fixture.
 */

type ProductConfig = {
  code: string;
  name: string;
  price: string;
  tankCode: string;
  capacityLitres: string;
  openingLitres: string;
  unitCost: string;
};

type ShiftConfig = {
  code: string;
  name: string;
  start: string;
  end: string;
};

type StationConfig = {
  code: string;
  name: string;
  products: ProductConfig[];
  shifts: ShiftConfig[];
};

const DEMO = {
  tenant: { slug: 'tei-oils-demo', name: 'TEI Oils Demo' },
  legalName: 'TEI Oils (Pvt) Ltd',
  currency: 'USD',
  password: process.env.LOCAL_DEMO_PASSWORD ?? 'Demo1234!',
  stations: [
    {
      code: 'BINDURA',
      name: 'Bindura',
      products: [
        {
          code: 'DIESEL',
          name: 'Diesel',
          price: '1.780000',
          tankCode: 'D1',
          capacityLitres: '20000',
          openingLitres: '12000',
          unitCost: '1.42000000',
        },
        {
          code: 'PETROL',
          name: 'Petrol',
          price: '1.960000',
          tankCode: 'P1',
          capacityLitres: '15000',
          openingLitres: '8500',
          unitCost: '1.56000000',
        },
      ],
      shifts: [
        { code: 'DAY', name: 'Day shift', start: '06:00', end: '18:00' },
        { code: 'NIGHT', name: 'Night shift', start: '18:00', end: '06:00' },
      ],
    },
    {
      code: 'ARCTURUS',
      name: 'Arcturus',
      products: [
        {
          code: 'DIESEL',
          name: 'Diesel',
          price: '1.780000',
          tankCode: 'D1',
          capacityLitres: '20000',
          openingLitres: '11800',
          unitCost: '1.42000000',
        },
        {
          code: 'PETROL',
          name: 'Petrol',
          price: '1.960000',
          tankCode: 'P1',
          capacityLitres: '15000',
          openingLitres: '8200',
          unitCost: '1.56000000',
        },
      ],
      shifts: [
        { code: 'DAY', name: 'Day shift', start: '06:00', end: '18:00' },
        { code: 'NIGHT', name: 'Night shift', start: '18:00', end: '06:00' },
      ],
    },
    {
      code: 'GAZEBO',
      name: 'Gazebo',
      products: [
        {
          code: 'DIESEL',
          name: 'Diesel',
          price: '1.780000',
          tankCode: 'D1',
          capacityLitres: '20000',
          openingLitres: '10500',
          unitCost: '1.42000000',
        },
        {
          code: 'PETROL',
          name: 'Petrol',
          price: '1.960000',
          tankCode: 'P1',
          capacityLitres: '15000',
          openingLitres: '7600',
          unitCost: '1.56000000',
        },
      ],
      shifts: [
        { code: 'DAY', name: 'Day shift', start: '06:00', end: '18:00' },
        { code: 'NIGHT', name: 'Night shift', start: '18:00', end: '06:00' },
      ],
    },
    {
      code: 'MARUTA',
      name: 'Maruta',
      products: [
        {
          code: 'DIESEL',
          name: 'Diesel',
          price: '1.780000',
          tankCode: 'D1',
          capacityLitres: '20000',
          openingLitres: '11200',
          unitCost: '1.42000000',
        },
        {
          code: 'PETROL',
          name: 'Petrol',
          price: '1.960000',
          tankCode: 'P1',
          capacityLitres: '15000',
          openingLitres: '7900',
          unitCost: '1.56000000',
        },
      ],
      shifts: [
        { code: 'DAY', name: 'Day shift', start: '06:00', end: '18:00' },
        { code: 'NIGHT', name: 'Night shift', start: '18:00', end: '06:00' },
      ],
    },
  ] satisfies StationConfig[],
};

function deterministicId(key: string): string {
  const digest = createHash('sha256').update(`shanda-fuel-local-demo:${key}`).digest('hex');
  const versioned = `4${digest.slice(13)}`;
  const variant = `${['8', '9', 'a', 'b'][Number.parseInt(digest[16] ?? '8', 16) % 4]}${digest.slice(17)}`;
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${versioned.slice(0, 4)}-${variant.slice(0, 4)}-${digest.slice(20, 32)}`;
}

function localDate(): string {
  return (
    process.env.DEMO_BUSINESS_DATE ??
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Harare',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  );
}

function harareTime(date: string, time: string): string {
  // Zimbabwe remains UTC+02:00; using an explicit offset keeps the fixture
  // deterministic and avoids the host machine timezone influencing shifts.
  return `${date}T${time}:00+02:00`;
}

function nextCalendarDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

function databaseName(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
}

function ensureDisposableDatabase(databaseUrl: string): string {
  const name = databaseName(databaseUrl);
  const expectedName = process.env.LOCAL_DEMO_DATABASE_NAME ?? 'shanda_fuel_codex_test_20261017';
  if (name !== expectedName) {
    throw new Error(
      `Refusing to seed database ${name}. Set LOCAL_DEMO_DATABASE_NAME to the exact disposable database name before retrying.`,
    );
  }
  return name;
}

async function seed(sql: Sql): Promise<void> {
  const date = localDate();
  const dayStart = harareTime(date, '06:00');
  const tenantId = deterministicId('tenant');
  const legalEntityId = deterministicId('legal-entity');
  const ownerUserId = deterministicId('user-owner');
  const ownerMembershipId = deterministicId('membership-owner');
  const passwordHash = await hashPassword(DEMO.password);
  const productIds = new Map<string, string>();

  await sql.begin(async (tx) => {
    await tx`
      insert into auth."user" (id, name, email, email_verified)
      values (${ownerUserId}, 'TEI Oils Demo Owner', 'owner@tei-oils.demo', true)
      on conflict (id) do update set name = excluded.name, email_verified = true
    `;
    await tx`
      insert into auth.account (account_id, provider_id, user_id, password)
      values (${'owner@tei-oils.demo'}, 'credential', ${ownerUserId}, ${passwordHash})
      on conflict (provider_id, account_id) do update set password = excluded.password
    `;
    await tx`
      insert into app.tenants (id, name, slug, status)
      values (${tenantId}, ${DEMO.tenant.name}, ${DEMO.tenant.slug}, 'ACTIVE')
      on conflict (id) do update set name = excluded.name, status = 'ACTIVE'
    `;
    await tx`
      insert into app.legal_entities (id, tenant_id, legal_name, status)
      values (${legalEntityId}, ${tenantId}, ${DEMO.legalName}, 'ACTIVE')
      on conflict (id) do update set legal_name = excluded.legal_name, status = 'ACTIVE'
    `;
    await tx`
      insert into app.memberships (id, tenant_id, identity_id, status)
      values (${ownerMembershipId}, ${tenantId}, ${ownerUserId}, 'ACTIVE')
      on conflict (id) do update set status = 'ACTIVE'
    `;
    await tx`
      insert into app.membership_role_assignments
        (id, tenant_id, membership_id, role_code, scope_type)
      values (${deterministicId('role-owner')}, ${tenantId}, ${ownerMembershipId}, 'OWNER', 'TENANT')
      on conflict (id) do nothing
    `;

    for (const product of DEMO.stations[0]!.products) {
      const productId = deterministicId(`product-${product.code}`);
      productIds.set(product.code, productId);
      await tx`
        insert into app.products (id, tenant_id, code, name, status)
        values (${productId}, ${tenantId}, ${product.code}, ${product.name}, 'ACTIVE')
        on conflict (id) do update set name = excluded.name, status = 'ACTIVE';
      `;
    }

    for (const station of DEMO.stations) {
      const stationId = deterministicId(`station-${station.code}`);
      const supervisorUserId = deterministicId(`user-supervisor-${station.code}`);
      const supervisorMembershipId = deterministicId(`membership-supervisor-${station.code}`);
      const attendantUserId = deterministicId(`user-attendant-${station.code}`);
      const attendantMembershipId = deterministicId(`membership-attendant-${station.code}`);
      const dayId = deterministicId(`business-day-${station.code}-${date}`);

      await tx`
        insert into app.stations (id, tenant_id, legal_entity_id, code, name, timezone, status)
        values (${stationId}, ${tenantId}, ${legalEntityId}, ${station.code}, ${station.name}, 'Africa/Harare', 'ACTIVE')
        on conflict (id) do update set name = excluded.name, timezone = excluded.timezone, status = 'ACTIVE'
      `;
      await tx`
        insert into auth."user" (id, name, email, email_verified)
        values
          (${supervisorUserId}, ${`${station.name} Supervisor`}, ${`supervisor.${station.code.toLowerCase()}@tei-oils.demo`}, true),
          (${attendantUserId}, ${`${station.name} Attendant`}, ${`attendant.${station.code.toLowerCase()}@tei-oils.demo`}, true)
        on conflict (id) do update set email_verified = true
      `;
      await tx`
        insert into auth.account (account_id, provider_id, user_id, password)
        values
          (${`supervisor.${station.code.toLowerCase()}@tei-oils.demo`}, 'credential', ${supervisorUserId}, ${passwordHash}),
          (${`attendant.${station.code.toLowerCase()}@tei-oils.demo`}, 'credential', ${attendantUserId}, ${passwordHash})
        on conflict (provider_id, account_id) do update set password = excluded.password
      `;
      await tx`
        insert into app.memberships (id, tenant_id, identity_id, status)
        values
          (${supervisorMembershipId}, ${tenantId}, ${supervisorUserId}, 'ACTIVE'),
          (${attendantMembershipId}, ${tenantId}, ${attendantUserId}, 'ACTIVE')
        on conflict (id) do update set status = 'ACTIVE'
      `;
      await tx`
        insert into app.membership_role_assignments
          (id, tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values
          (${deterministicId(`role-supervisor-${station.code}`)}, ${tenantId}, ${supervisorMembershipId}, 'SUPERVISOR', 'STATION', ${legalEntityId}, ${stationId}),
          (${deterministicId(`role-attendant-${station.code}`)}, ${tenantId}, ${attendantMembershipId}, 'ATTENDANT', 'STATION', ${legalEntityId}, ${stationId})
        on conflict (id) do nothing
      `;
      await tx`
        insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
        values (${dayId}, ${tenantId}, ${stationId}, ${date}, 'NOT_STARTED')
        on conflict (id) do nothing
      `;

      for (const shift of station.shifts) {
        const shiftTemplateId = deterministicId(`shift-template-${station.code}-${shift.code}`);
        const shiftId = deterministicId(`shift-${station.code}-${shift.code}-${date}`);
        const endDate = shift.end === '06:00' ? nextCalendarDate(date) : date;
        const plannedStart = harareTime(date, shift.start);
        const plannedEnd =
          shift.end === '06:00' ? harareTime(endDate, shift.end) : harareTime(date, shift.end);
        await tx`
          insert into app.shift_templates
            (id, tenant_id, station_id, code, name, duration_minutes, active, created_by)
          values (${shiftTemplateId}, ${tenantId}, ${stationId}, ${shift.code}, ${shift.name}, 720, true, ${supervisorMembershipId})
          on conflict (id) do update set name = excluded.name, duration_minutes = 720, active = true
        `;
        await tx`
          insert into app.shifts
            (id, tenant_id, station_id, business_day_id, state, planned_start_at, planned_end_at, shift_template_id, business_date)
          values (${shiftId}, ${tenantId}, ${stationId}, ${dayId}, 'PLANNED', ${plannedStart}, ${plannedEnd}, ${shiftTemplateId}, ${date})
          on conflict (id) do update set planned_start_at = excluded.planned_start_at, planned_end_at = excluded.planned_end_at
        `;
      }

      const pumpIds = [1, 2].map((number) => deterministicId(`pump-${station.code}-${number}`));
      for (const [index, pumpId] of pumpIds.entries()) {
        await tx`
          insert into app.pumps (id, tenant_id, station_id, number, name, status)
          values (${pumpId}, ${tenantId}, ${stationId}, ${String(index + 1)}, ${`Pump ${index + 1}`}, 'ACTIVE')
          on conflict (id) do update set name = excluded.name, status = 'ACTIVE'
        `;
        for (const [nozzleIndex, product] of station.products.entries()) {
          const productId = productIds.get(product.code)!;
          const nozzleId = deterministicId(`nozzle-${station.code}-${index + 1}-${product.code}`);
          const meterId = deterministicId(`meter-${station.code}-${index + 1}-${product.code}`);
          const installationId = deterministicId(
            `installation-${station.code}-${index + 1}-${product.code}`,
          );
          await tx`
            insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
            values (${nozzleId}, ${tenantId}, ${stationId}, ${pumpId}, ${String(nozzleIndex + 1)}, ${productId}, 'ACTIVE')
            on conflict (id) do update set product_id = excluded.product_id, status = 'ACTIVE'
          `;
          await tx`
            insert into app.meters (id, tenant_id, serial_number, status)
            values (${meterId}, ${tenantId}, ${`DEMO-${station.code}-${index + 1}-${product.code}`}, 'ACTIVE')
            on conflict (id) do update set status = 'ACTIVE'
          `;
          await tx`
            insert into app.meter_installations
              (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
            values (${installationId}, ${tenantId}, ${stationId}, ${nozzleId}, ${meterId}, ${'2026-01-01T04:00:00Z'}, ${supervisorMembershipId})
            on conflict (id) do nothing
          `;
        }
      }

      for (const product of station.products) {
        const productId = productIds.get(product.code)!;
        const tankId = deterministicId(`tank-${station.code}-${product.code}`);
        const priceId = deterministicId(`price-${station.code}-${product.code}`);
        const openingMovementId = deterministicId(
          `opening-movement-${station.code}-${product.code}`,
        );
        const openingCostId = deterministicId(`opening-cost-${station.code}-${product.code}`);
        const openingDipId = deterministicId(`opening-dip-${station.code}-${product.code}-${date}`);
        const supplierDeliveryId = deterministicId(`delivery-${station.code}-${product.code}`);
        const deliveryLitres = '1000';

        await tx`
          insert into app.tanks
            (id, tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres, acceptable_variance_litres, status, created_by, updated_by)
          values (${tankId}, ${tenantId}, ${stationId}, ${product.tankCode}, ${productId}, ${product.capacityLitres}, '1000', '25', 'ACTIVE', ${supervisorMembershipId}, ${supervisorMembershipId})
          on conflict (id) do update set capacity_litres = excluded.capacity_litres, reorder_level_litres = excluded.reorder_level_litres, acceptable_variance_litres = excluded.acceptable_variance_litres, status = 'ACTIVE'
        `;
        await tx`
          insert into app.tank_calibration_points
            (id, tenant_id, station_id, tank_id, measurement_value, measurement_unit, litres, recorded_by)
          values
            (${deterministicId(`calibration-${station.code}-${product.code}-0`)}, ${tenantId}, ${stationId}, ${tankId}, '0', 'mm', '0', ${supervisorMembershipId}),
            (${deterministicId(`calibration-${station.code}-${product.code}-max`)}, ${tenantId}, ${stationId}, ${tankId}, '2000', 'mm', ${product.capacityLitres}, ${supervisorMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.selling_prices
            (id, tenant_id, station_id, product_id, effective_from, unit_price, currency, state, requested_by)
          values (${priceId}, ${tenantId}, ${stationId}, ${productId}, ${'2026-01-01T04:00:00Z'}, ${product.price}, ${DEMO.currency}, 'DRAFT', ${supervisorMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          update app.selling_prices set state = 'PENDING_APPROVAL'
          where id = ${priceId} and state = 'DRAFT'
        `;
        await tx`
          update app.selling_prices set state = 'APPROVED', approved_by = ${ownerMembershipId}, approved_at = now()
          where id = ${priceId} and state = 'PENDING_APPROVAL'
        `;
        await tx`
          update app.selling_prices set state = 'PENDING_STATION_ACTIVATION'
          where id = ${priceId} and state = 'APPROVED'
        `;
        await tx`
          update app.selling_prices set state = 'BOUNDARIES_IN_PROGRESS'
          where id = ${priceId} and state = 'PENDING_STATION_ACTIVATION'
        `;
        await tx`
          update app.selling_prices set state = 'ACTIVE', activated_at = now()
          where id = ${priceId} and state = 'BOUNDARIES_IN_PROGRESS'
        `;
        await tx`
          insert into app.inventory_movements
            (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id, unit_landed_cost, total_landed_cost, currency)
          values (${openingMovementId}, ${tenantId}, ${stationId}, ${tankId}, ${productId}, 'OPENING_BALANCE', ${product.openingLitres}, ${dayStart}, ${date}, 'OPENING_BALANCE', ${openingMovementId}, ${supervisorMembershipId}, ${product.unitCost}, (${product.openingLitres}::numeric * ${product.unitCost}::numeric), ${DEMO.currency})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.inventory_cost_events
            (id, tenant_id, station_id, tank_id, product_id, event_type, source_type, source_id, effective_at, business_date, amount, currency, actor_membership_id)
          values (${openingCostId}, ${tenantId}, ${stationId}, ${tankId}, ${productId}, 'OPENING_COST', 'OPENING_BALANCE', ${openingMovementId}, ${dayStart}, ${date}, (${product.openingLitres}::numeric * ${product.unitCost}::numeric), ${DEMO.currency}, ${supervisorMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.inventory_cost_stream_state
            (tenant_id, station_id, tank_id, product_id, quantity_litres, inventory_value, weighted_average_cost, currency, valuation_status, last_movement_effective_at, last_movement_id, last_cost_event_effective_at, last_cost_event_id)
          values (${tenantId}, ${stationId}, ${tankId}, ${productId}, ${product.openingLitres}, (${product.openingLitres}::numeric * ${product.unitCost}::numeric), ${product.unitCost}, ${DEMO.currency}, 'VALUED', ${dayStart}, ${openingMovementId}, ${dayStart}, ${openingCostId})
          on conflict (tenant_id, station_id, tank_id, product_id) do update set quantity_litres = excluded.quantity_litres, inventory_value = excluded.inventory_value, weighted_average_cost = excluded.weighted_average_cost, currency = excluded.currency, valuation_status = 'VALUED', last_movement_effective_at = excluded.last_movement_effective_at, last_movement_id = excluded.last_movement_id, last_cost_event_effective_at = excluded.last_cost_event_effective_at, last_cost_event_id = excluded.last_cost_event_id
        `;
        await tx`
          insert into app.tank_dips (id, tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by, notes)
          values (${openingDipId}, ${tenantId}, ${stationId}, ${tankId}, ${dayStart}, ${date}, ${product.openingLitres}, ${supervisorMembershipId}, 'Local demo opening dip')
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.fuel_deliveries
            (id, tenant_id, station_id, product_id, delivery_note_number, delivered_at, business_date, note_quantity_litres, actual_quantity_litres, shortage_excess_litres, supplier_reference, transporter, driver, truck_registration, status, unit_landed_cost, total_landed_cost, currency, recorded_by)
          values (${supplierDeliveryId}, ${tenantId}, ${stationId}, ${productId}, ${`DEMO-${station.code}-${product.code}-001`}, ${dayStart}, ${date}, ${deliveryLitres}, ${deliveryLitres}, '0', 'Demo Supplier on credit', 'Demo Logistics', 'Demo Driver', 'DEMO-TRUCK-01', 'DRAFT', ${product.unitCost}, (${deliveryLitres}::numeric * ${product.unitCost}::numeric), ${DEMO.currency}, ${supervisorMembershipId})
          on conflict (id) do nothing
        `;

        // The delivery is intentionally left DRAFT: it demonstrates an
        // unposted supplier-credit record without changing available stock.
      }

      if (station.code === 'BINDURA') {
        const activeShiftId = deterministicId(`shift-${station.code}-DAY-${date}`);
        const reconciliationId = deterministicId(`reconciliation-${station.code}-${date}`);
        const tillId = deterministicId(`cash-location-${station.code}-TILL`);
        const safeId = deterministicId(`cash-location-${station.code}-SAFE`);
        const customerId = deterministicId(`customer-${station.code}-DEMO-FLEET`);
        const customerAccountId = deterministicId(`customer-account-${station.code}-DEMO-FLEET`);
        const customerAuthorizationId = deterministicId(
          `customer-authorization-${station.code}-${date}`,
        );
        const customerLedgerId = deterministicId(`customer-ledger-${station.code}-${date}`);
        const saleEnd = harareTime(date, '18:00');

        // Open one synthetic operating day/shift so the owner can follow the
        // normal day -> shift -> meter -> reconciliation journey.
        await tx`
          update app.station_business_days
          set state = 'OPEN', opened_at = ${dayStart}, updated_at = now(), version = version + 1
          where id = ${dayId} and state = 'NOT_STARTED'
        `;
        await tx`
          update app.shifts
          set state = 'OPEN', opened_at = ${dayStart}, version = version + 1
          where id = ${activeShiftId} and state = 'PLANNED'
        `;

        const sales = [
          {
            pump: 1,
            product: 'DIESEL',
            opening: '1000.000',
            closing: '1010.000',
            litres: '10.000',
          },
          {
            pump: 2,
            product: 'DIESEL',
            opening: '2000.000',
            closing: '2020.000',
            litres: '20.000',
          },
          { pump: 1, product: 'PETROL', opening: '3000.000', closing: '3008.000', litres: '8.000' },
          {
            pump: 2,
            product: 'PETROL',
            opening: '4000.000',
            closing: '4012.000',
            litres: '12.000',
          },
        ] as const;

        await tx`
          insert into app.reconciliations
            (id, tenant_id, station_id, business_day_id, shift_id, supervisor_id, created_by, state)
          values (${reconciliationId}, ${tenantId}, ${stationId}, ${dayId}, ${activeShiftId}, ${supervisorMembershipId}, ${supervisorMembershipId}, 'DRAFT')
          on conflict (id) do nothing
        `;

        for (const sale of sales) {
          const productId = productIds.get(sale.product)!;
          const nozzleId = deterministicId(`nozzle-${station.code}-${sale.pump}-${sale.product}`);
          const installationId = deterministicId(
            `installation-${station.code}-${sale.pump}-${sale.product}`,
          );
          const priceId = deterministicId(`price-${station.code}-${sale.product}`);
          const openingReading = sale.opening;
          const closingReading = sale.closing;
          const openingBoundaryId = deterministicId(
            `demo-opening-boundary-${station.code}-${date}-${sale.pump}-${sale.product}`,
          );
          const closingBoundaryId = deterministicId(
            `demo-closing-boundary-${station.code}-${date}-${sale.pump}-${sale.product}`,
          );
          const segmentId = deterministicId(
            `demo-meter-segment-${station.code}-${date}-${sale.pump}-${sale.product}`,
          );
          const readingId = deterministicId(
            `demo-meter-reading-${station.code}-${date}-${sale.pump}-${sale.product}`,
          );
          const saleStart = harareTime(date, '06:00');

          await tx`
            insert into app.meter_boundaries
              (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, reason, reading_status, reading_value, effective_at, confirmed_at, confirmed_by, entered_by, attendant_id)
            values
              (${openingBoundaryId}, ${tenantId}, ${stationId}, ${nozzleId}, ${installationId}, ${dayId}, ${activeShiftId}, 'SHIFT_OPEN', 'AVAILABLE', ${openingReading}, ${saleStart}, ${saleStart}, ${supervisorMembershipId}, ${supervisorMembershipId}, ${attendantMembershipId}),
              (${closingBoundaryId}, ${tenantId}, ${stationId}, ${nozzleId}, ${installationId}, ${dayId}, ${activeShiftId}, 'SHIFT_CLOSE', 'AVAILABLE', ${closingReading}, ${saleEnd}, ${saleEnd}, ${supervisorMembershipId}, ${supervisorMembershipId}, ${attendantMembershipId})
            on conflict (id) do nothing
          `;
          await tx`
            insert into app.meter_segments
              (id, tenant_id, station_id, nozzle_id, meter_installation_id, business_day_id, shift_id, opening_boundary_id, closing_boundary_id, product_id, attendant_id, entered_by, opening_reading, closing_reading, litres, unit_price, selling_price_id, expected_sale_value, currency, boundary_reason, segment_start_at, segment_end_at, sealed_at, state)
            values
              (${segmentId}, ${tenantId}, ${stationId}, ${nozzleId}, ${installationId}, ${dayId}, ${activeShiftId}, ${openingBoundaryId}, ${closingBoundaryId}, ${productId}, ${attendantMembershipId}, ${supervisorMembershipId}, ${openingReading}, ${closingReading}, ${sale.litres}, (select unit_price from app.selling_prices where id = ${priceId}), ${priceId}, round(${sale.litres}::numeric * (select unit_price from app.selling_prices where id = ${priceId}), 4), ${DEMO.currency}, 'SHIFT_CLOSE', ${saleStart}, ${saleEnd}, ${saleEnd}, 'OPEN')
            on conflict (id) do nothing
          `;
          await tx`
            update app.meter_segments
            set state = 'SEALED', version = version + 1
            where id = ${segmentId} and state = 'OPEN'
          `;
          await tx`
            insert into app.reconciliation_meter_readings
              (id, tenant_id, station_id, reconciliation_id, shift_id, nozzle_id, product_id, opening_reading, closing_reading, litres_sold, selling_price_id, unit_price, sales_value, currency, entered_by)
            select ${readingId}, ${tenantId}, ${stationId}, ${reconciliationId}, ${activeShiftId}, ${nozzleId}, ${productId}, ${openingReading}, ${closingReading}, ${sale.litres}, ${priceId}, unit_price, round(${sale.litres}::numeric * unit_price, 4), ${DEMO.currency}, ${attendantMembershipId}
            from app.selling_prices where id = ${priceId}
            on conflict (id) do nothing
          `;
        }

        await tx`
          insert into app.reconciliation_attendants
            (id, tenant_id, station_id, reconciliation_id, attendant_id, assigned_by)
          values (${deterministicId(`reconciliation-attendant-${station.code}-${date}`)}, ${tenantId}, ${stationId}, ${reconciliationId}, ${attendantMembershipId}, ${supervisorMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.reconciliation_payments
            (id, tenant_id, station_id, reconciliation_id, method, amount, reference, note, entered_by)
          values
            (${deterministicId(`reconciliation-payment-${station.code}-${date}-cash`)}, ${tenantId}, ${stationId}, ${reconciliationId}, 'CASH', '40.0000', 'DEMO-CASH-001', 'Synthetic till declaration', ${attendantMembershipId}),
            (${deterministicId(`reconciliation-payment-${station.code}-${date}-pos`)}, ${tenantId}, ${stationId}, ${reconciliationId}, 'POS', '20.0000', 'DEMO-POS-001', 'Synthetic card terminal declaration', ${attendantMembershipId}),
            (${deterministicId(`reconciliation-payment-${station.code}-${date}-ecocash`)}, ${tenantId}, ${stationId}, ${reconciliationId}, 'ECOCASH', '20.0000', 'DEMO-ECOCASH-001', 'Synthetic mobile-money declaration', ${attendantMembershipId}),
            (${deterministicId(`reconciliation-payment-${station.code}-${date}-credit`)}, ${tenantId}, ${stationId}, ${reconciliationId}, 'CUSTOMER_CREDIT', '12.6000', 'DEMO-CREDIT-001', 'Synthetic fleet credit delivery', ${attendantMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.reconciliation_expenses
            (id, tenant_id, station_id, reconciliation_id, category, description, amount, payment_method, person_paid, reference, entered_by)
          values (${deterministicId(`reconciliation-expense-${station.code}-${date}`)}, ${tenantId}, ${stationId}, ${reconciliationId}, 'Sundry', 'Synthetic cash-paid cleaning supplies', '5.0000', 'CASH', 'Demo attendant', 'DEMO-EXP-001', ${attendantMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.reconciliation_cash_declarations
            (id, tenant_id, station_id, reconciliation_id, counted_cash, expected_physical_cash, cash_paid_expenses, net_expected_cash, cash_variance, explanation, entered_by)
          values (${deterministicId(`reconciliation-cash-${station.code}-${date}`)}, ${tenantId}, ${stationId}, ${reconciliationId}, '35.0000', '40.0000', '5.0000', '35.0000', '0.0000', 'Synthetic exact cash count after paid expense', ${attendantMembershipId})
          on conflict (id) do nothing
        `;

        await tx`
          insert into app.cash_locations (id, tenant_id, station_id, code, name, location_type, currency, status)
          values
            (${tillId}, ${tenantId}, ${stationId}, 'DEMO-TILL', 'Demo till', 'STATION_TILL', ${DEMO.currency}, 'ACTIVE'),
            (${safeId}, ${tenantId}, ${stationId}, 'DEMO-SAFE', 'Demo safe', 'STATION_SAFE', ${DEMO.currency}, 'ACTIVE')
          on conflict (id) do nothing
        `;
        const cashPaymentId = deterministicId(
          `reconciliation-payment-${station.code}-${date}-cash`,
        );
        const cashExpenseId = deterministicId(`reconciliation-expense-${station.code}-${date}`);
        const collectionId = deterministicId(`cash-collection-${station.code}-${date}`);
        await tx`
          insert into app.cash_movements
            (id, tenant_id, station_id, movement_type, amount, currency, to_location_id, source_type, source_id, business_date, effective_at, reason, actor_membership_id)
          values (${deterministicId(`cash-receipt-${station.code}-${date}`)}, ${tenantId}, ${stationId}, 'RECEIPT', '40.0000', ${DEMO.currency}, ${tillId}, 'RECONCILIATION_PAYMENT', ${cashPaymentId}, ${date}, ${saleEnd}, 'Synthetic cash sales receipt', ${supervisorMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.cash_movements
            (id, tenant_id, station_id, movement_type, amount, currency, from_location_id, source_type, source_id, business_date, effective_at, reason, actor_membership_id)
          values (${deterministicId(`cash-disbursement-${station.code}-${date}`)}, ${tenantId}, ${stationId}, 'DISBURSEMENT', '5.0000', ${DEMO.currency}, ${tillId}, 'RECONCILIATION_EXPENSE', ${cashExpenseId}, ${date}, ${saleEnd}, 'Synthetic cash-paid expense', ${supervisorMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.cash_collections
            (id, tenant_id, station_id, collection_reference, source_location_id, current_location_id, amount, currency, business_date, state, recorded_by, received_by, received_at)
          values (${collectionId}, ${tenantId}, ${stationId}, 'DEMO-COLLECTION-001', ${tillId}, ${safeId}, '35.0000', ${DEMO.currency}, ${date}, 'RECEIVED', ${supervisorMembershipId}, ${ownerMembershipId}, ${saleEnd})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.cash_collection_allocations
            (id, tenant_id, station_id, collection_id, reconciliation_id, amount, currency, allocated_by)
          values (${deterministicId(`cash-collection-allocation-${station.code}-${date}`)}, ${tenantId}, ${stationId}, ${collectionId}, ${reconciliationId}, '35.0000', ${DEMO.currency}, ${ownerMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.cash_counts
            (id, tenant_id, station_id, location_id, business_date, counted_at, expected_amount, counted_amount, variance, currency, explanation, counted_by)
          values (${deterministicId(`cash-count-${station.code}-${date}`)}, ${tenantId}, ${stationId}, ${safeId}, ${date}, ${saleEnd}, '35.0000', '35.0000', '0.0000', ${DEMO.currency}, 'Synthetic exact safe count', ${ownerMembershipId})
          on conflict (id) do nothing
        `;

        await tx`
          insert into app.payment_providers (id, tenant_id, code, name, provider_type, status, created_by)
          values
            (${deterministicId(`provider-${station.code}-POS`)}, ${tenantId}, 'DEMO-POS', 'Demo POS provider', 'POS', 'ACTIVE', ${ownerMembershipId}),
            (${deterministicId(`provider-${station.code}-ECOCASH`)}, ${tenantId}, 'DEMO-ECOCASH', 'Demo EcoCash provider', 'MOBILE_MONEY', 'ACTIVE', ${ownerMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.provider_accounts
            (id, tenant_id, provider_id, legal_entity_id, station_id, account_reference, display_name, currency, status, created_by, updated_by)
          values
            (${deterministicId(`provider-account-${station.code}-POS`)}, ${tenantId}, ${deterministicId(`provider-${station.code}-POS`)}, ${legalEntityId}, ${stationId}, 'DEMO-POS-ACCOUNT', 'Demo POS account', ${DEMO.currency}, 'ACTIVE', ${ownerMembershipId}, ${ownerMembershipId}),
            (${deterministicId(`provider-account-${station.code}-ECOCASH`)}, ${tenantId}, ${deterministicId(`provider-${station.code}-ECOCASH`)}, ${legalEntityId}, ${stationId}, 'DEMO-ECOCASH-ACCOUNT', 'Demo EcoCash account', ${DEMO.currency}, 'ACTIVE', ${ownerMembershipId}, ${ownerMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.provider_settlements
            (id, tenant_id, provider_account_id, station_id, settlement_reference, batch_reference, transaction_date, settlement_date, currency, gross_amount, reported_net_amount, source_type, source_key, state, recorded_by)
          values
            (${deterministicId(`provider-settlement-${station.code}-${date}-pos`)}, ${tenantId}, ${deterministicId(`provider-account-${station.code}-POS`)}, ${stationId}, 'DEMO-POS-SETTLEMENT-001', 'DEMO-POS-BATCH-001', ${date}, ${date}, ${DEMO.currency}, '20.0000', '20.0000', 'MANUAL', 'local-demo-pos-settlement', 'RECORDED', ${ownerMembershipId}),
            (${deterministicId(`provider-settlement-${station.code}-${date}-ecocash`)}, ${tenantId}, ${deterministicId(`provider-account-${station.code}-ECOCASH`)}, ${stationId}, 'DEMO-ECOCASH-SETTLEMENT-001', 'DEMO-ECOCASH-BATCH-001', ${date}, ${date}, ${DEMO.currency}, '20.0000', '20.0000', 'MANUAL', 'local-demo-ecocash-settlement', 'RECORDED', ${ownerMembershipId})
          on conflict (id) do nothing
        `;

        await tx`
          insert into app.customers
            (id, tenant_id, account_reference, display_name, status, created_by, updated_by)
          values (${customerId}, ${tenantId}, 'DEMO-FLEET-001', 'Demo Fleet Customer', 'ACTIVE', ${ownerMembershipId}, ${ownerMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.customer_accounts
            (id, tenant_id, customer_id, account_type, currency, credit_limit, status, created_by, updated_by)
          values (${customerAccountId}, ${tenantId}, ${customerId}, 'CREDIT', ${DEMO.currency}, '500.0000', 'ACTIVE', ${ownerMembershipId}, ${ownerMembershipId})
          on conflict (id) do nothing
        `;
        await tx`
          insert into app.customer_fuel_authorizations
            (id, tenant_id, station_id, customer_id, account_id, account_type, product_id, currency, requested_amount, requested_litres, used_amount, used_litres, remaining_amount, remaining_litres, state, source_type, source_id, source_key, requested_by, requested_at, authorized_at, completed_at)
          values (${customerAuthorizationId}, ${tenantId}, ${stationId}, ${customerId}, ${customerAccountId}, 'CREDIT', ${productIds.get('DIESEL')}, ${DEMO.currency}, '12.6000', '6.429', '12.6000', '6.429', '0.0000', '0.000', 'REQUESTED', 'A5_RECONCILIATION_CUSTOMER_FUEL', ${reconciliationId}, 'local-demo-credit-delivery', ${supervisorMembershipId}, ${saleEnd}, null, null)
          on conflict (id) do nothing
        `;
        await tx`
          update app.customer_fuel_authorizations
          set state = 'AUTHORIZED', authorized_at = ${saleEnd}
          where id = ${customerAuthorizationId} and state = 'REQUESTED'
        `;
        await tx`
          update app.customer_fuel_authorizations
          set state = 'COMPLETED', completed_at = ${saleEnd}
          where id = ${customerAuthorizationId} and state = 'AUTHORIZED'
        `;
        await tx`
          insert into app.customer_ledger_entries
            (id, tenant_id, customer_id, account_id, account_type, entry_type, direction, amount, product_id, source_type, source_id, source_key, occurred_at, business_date, note, actor_membership_id)
          values (${customerLedgerId}, ${tenantId}, ${customerId}, ${customerAccountId}, 'CREDIT', 'CREDIT_FUEL_CHARGE', 'INCREASE', '12.6000', ${productIds.get('DIESEL')}, 'A5_RECONCILIATION_CUSTOMER_FUEL', ${reconciliationId}, 'local-demo-credit-ledger', ${saleEnd}, ${date}, 'Synthetic fleet credit fuel delivery', ${supervisorMembershipId})
          on conflict (id) do nothing
        `;
      }

      const demoExpenseId = deterministicId(`expense-${station.code}`);
      await tx`
        insert into app.expenses
          (id, tenant_id, legal_entity_id, station_id, business_date, description, category, amount, currency, classification, settlement_source, state, approval_required, required_approver_count, created_by, submitted_by, submitted_at)
        values
          (${demoExpenseId}, ${tenantId}, ${legalEntityId}, ${stationId}, ${date}, 'Demo station maintenance', 'Maintenance', '45.0000', ${DEMO.currency}, 'OPERATING_EXPENSE', 'CASH', 'SUBMITTED', true, 1, ${supervisorMembershipId}, ${supervisorMembershipId}, now())
        on conflict (id) do nothing
      `;
      const recurringTemplateId = deterministicId(`recurring-expense-${station.code}`);
      await tx`
        insert into app.expense_recurring_templates
          (id, tenant_id, legal_entity_id, station_id, description, category, amount, currency, settlement_source, interval_unit, interval_count, anchor_date, active, approval_required, required_approver_count, created_by, updated_by)
        values
          (${recurringTemplateId}, ${tenantId}, ${legalEntityId}, ${stationId}, 'Demo monthly station rent', 'Rent', '90.3200', ${DEMO.currency}, 'BANK', 'MONTH', 1, ${date}, true, true, 1, ${ownerMembershipId}, ${ownerMembershipId})
        on conflict (id) do nothing
      `;
    }
  });

  console.log(`Seeded ${DEMO.tenant.name} (${DEMO.tenant.slug}) for business date ${date}.`);
  console.log(`Owner login: owner@tei-oils.demo / ${DEMO.password}`);
  console.log(
    'Station operator logins: supervisor.<station>@tei-oils.demo and attendant.<station>@tei-oils.demo',
  );
  console.log('All station operators have exactly one STATION-scoped assignment.');
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_ADMIN_URL;
  if (!databaseUrl)
    throw new Error('DATABASE_ADMIN_URL is required; runtime URLs are not accepted.');
  const name = ensureDisposableDatabase(databaseUrl);
  const sql = postgres(databaseUrl, { max: 1, prepare: false, connection: { TimeZone: 'UTC' } });
  try {
    await seed(sql);
    console.log(`Database: ${name}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
