/**
 * The TEI Oils demo company: two stations, diesel and petrol, thirty days of daily operations that
 * end yesterday, cash collected and banked, supplier invoices, fixed costs and customers.
 *
 * Every day, payment, collection, deposit, invoice and cost goes through the real command routes, so
 * the numbers on every screen come from the same code paths as the application. Only the company,
 * the people, the pumps and tanks and the cash locations are written directly, because the
 * application sets those up through the sign-in flow.
 *
 * It is run by `scripts/demo/reset-demo.sh`, which rebuilds a throwaway local database first. Running
 * it again against a database that already holds TEI Oils changes nothing and says so.
 *
 * It refuses to run anywhere except a loopback database with APP_ENV=local.
 */
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { clerkFixtures } from '../../tests/vitest/clerk-integration';
import { clerkHeaders, seedActiveStepUp } from '../../tests/integration/auth-session-fixtures';
import { POST as forecourtPost } from '../../src/app/api/forecourt/commands/route';
import { POST as inventoryPost } from '../../src/app/api/inventory/commands/route';
import { POST as cashPost } from '../../src/app/api/cash/commands/route';
import { POST as expensePost } from '../../src/app/api/expenses/commands/route';
import { POST as supplierPost } from '../../src/app/api/suppliers/commands/route';
import { POST as customerPost } from '../../src/app/api/customers/commands/route';

const databaseUrl = process.env.DATABASE_URL ?? '';
const loopback = (() => {
  try {
    return ['127.0.0.1', 'localhost', '::1'].includes(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
})();

const routes = {
  forecourt: forecourtPost,
  inventory: inventoryPost,
  cash: cashPost,
  expense: expensePost,
  supplier: supplierPost,
  customer: customerPost,
} as const;
const paths = {
  forecourt: 'forecourt',
  inventory: 'inventory',
  cash: 'cash',
  expense: 'expenses',
  supplier: 'suppliers',
  customer: 'customers',
} as const;

const TENANT_SLUG = 'tei-oils';
const DAYS = 30;
const DIESEL_PRICE = 1.5;
const PETROL_PRICE = 1.65;

/** A fixed, readable id for everything the seed creates directly. */
const id = (kind: number, n = 0) =>
  `7e100000-0000-4000-8000-${String(kind * 1000 + n).padStart(12, '0')}`;

const tenantId = id(1);
const legalId = id(2);
const bankId = id(3);
const dieselProduct = id(4, 1);
const petrolProduct = id(4, 2);

type Who = 'owner' | 'finance' | 'supervisor1' | 'supervisor2';

const people: ReadonlyArray<{
  key: string;
  name: string;
  email: string;
  role: 'OWNER' | 'FINANCE' | 'SUPERVISOR' | 'ATTENDANT';
  station?: 0 | 1;
}> = [
  { key: 'owner', name: 'Rudo Mapfumo', email: 'owner@teioils.example', role: 'OWNER' },
  { key: 'finance', name: 'Farai Ncube', email: 'finance@teioils.example', role: 'FINANCE' },
  {
    key: 'supervisor1',
    name: 'Chipo Dube',
    email: 'chipo@teioils.example',
    role: 'SUPERVISOR',
    station: 0,
  },
  {
    key: 'supervisor2',
    name: 'Tafara Sibanda',
    email: 'tafara@teioils.example',
    role: 'SUPERVISOR',
    station: 1,
  },
  {
    key: 'attendant1',
    name: 'Tendai Moyo',
    email: 'tendai@teioils.example',
    role: 'ATTENDANT',
    station: 0,
  },
  {
    key: 'attendant2',
    name: 'Nyasha Chuma',
    email: 'nyasha@teioils.example',
    role: 'ATTENDANT',
    station: 1,
  },
];
const personIndex = (key: string) => people.findIndex((p) => p.key === key);
const userId = (key: string) => id(5, personIndex(key));
const membershipId = (key: string) => id(6, personIndex(key));

const stations = [
  {
    index: 0 as const,
    code: 'TEI1',
    name: 'TEI Oils Harare Road',
    supervisor: 'supervisor1' as const,
    attendant: 'attendant1',
    dieselLitres: 720,
    petrolLitres: 540,
    openingDiesel: 30000,
    openingPetrol: 22000,
  },
  {
    index: 1 as const,
    code: 'TEI2',
    name: 'TEI Oils Mutare Highway',
    supervisor: 'supervisor2' as const,
    attendant: 'attendant2',
    dieselLitres: 560,
    petrolLitres: 430,
    openingDiesel: 24000,
    openingPetrol: 18000,
  },
];

describe.skipIf(!loopback)('TEI Oils demo data', () => {
  it('seeds TEI Oils', async () => {
    if (process.env.APP_ENV !== 'local')
      throw new Error('The demo seed only runs with APP_ENV=local');
    const client: Sql = postgres(databaseUrl, { max: 1, prepare: false });
    try {
      await run(client);
    } finally {
      await client.end();
    }
  });
});

/** Dates in the stations' own time zone, so "yesterday" is the same day the screens call yesterday. */
function stationDate(offsetDays: number): string {
  const day = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Harare',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(day);
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`);) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

async function run(client: Sql) {
  const [existing] = await client`select id from app.tenants where slug=${TENANT_SLUG}`;
  if (existing) {
    console.log('TEI Oils is already in this database. Nothing was changed.');
    return;
  }

  const lastDate = stationDate(-1);
  const firstDate = stationDate(-DAYS);
  const dates = datesBetween(firstDate, lastDate);
  const dayBefore = (date: string) =>
    new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

  // ---- The company, the people and the stations ----
  await client.unsafe(`
    insert into app.tenants (id, name, slug) values ('${tenantId}', 'TEI Oils', '${TENANT_SLUG}');
    insert into app.legal_entities (id, tenant_id, legal_name) values ('${legalId}', '${tenantId}', 'TEI Oils (Private) Limited');
    insert into app.bank_accounts (id, tenant_id, legal_entity_id, name, bank_name, account_reference_masked)
      values ('${bankId}', '${tenantId}', '${legalId}', 'Operating account', 'CBZ Bank', '****7305');
    insert into app.products (id, tenant_id, code, name) values
      ('${dieselProduct}', '${tenantId}', 'DIESEL', 'Diesel 50'),
      ('${petrolProduct}', '${tenantId}', 'PETROL', 'Unleaded Petrol');
  `);
  for (const station of stations) {
    const stationId = id(10 + station.index);
    await client.unsafe(`
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status, timezone)
        values ('${stationId}', '${tenantId}', '${legalId}', '${station.code}', '${station.name}', 'ONBOARDING', 'Africa/Harare');
    `);
  }
  for (const person of people) {
    const stationId = person.station === undefined ? null : id(10 + person.station);
    await client.unsafe(`
      insert into app.users (id, name, email, email_verified)
        values ('${userId(person.key)}', '${person.name}', '${person.email}', true);
      insert into app.auth_identities (internal_user_id, provider, provider_user_id)
        values ('${userId(person.key)}', 'CLERK', 'user_tei_${person.key}');
      insert into app.memberships (id, tenant_id, identity_id, status)
        values ('${membershipId(person.key)}', '${tenantId}', '${userId(person.key)}', 'ACTIVE');
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values ('${tenantId}', '${membershipId(person.key)}', '${person.role}',
          '${stationId ? 'STATION' : 'TENANT'}', ${stationId ? `'${legalId}'` : 'null'}, ${stationId ? `'${stationId}'` : 'null'});
    `);
  }

  // Sessions for the real people; the command routes still authorise them from the database.
  const tokens = {} as Record<Who, string>;
  for (const who of ['owner', 'finance', 'supervisor1', 'supervisor2'] as const) {
    const sessionId = randomUUID();
    tokens[who] = `tei-${who}-token`;
    clerkFixtures.sessions.set(tokens[who], {
      id: sessionId,
      userId: `user_tei_${who}`,
      internalUserId: userId(who),
      expiresAt: new Date('2030-01-01T00:00:00Z'),
      factorVerificationAge: [0, 0],
      revoked: false,
    });
    await seedActiveStepUp(client, sessionId, tenantId);
  }

  async function call(
    kind: keyof typeof routes,
    input: Record<string, unknown>,
    key: string,
    who: Who,
  ) {
    const response = await routes[kind](
      new Request(`http://127.0.0.1:3000/api/${paths[kind]}/commands`, {
        method: 'POST',
        headers: {
          ...clerkHeaders(tokens[who]),
          'content-type': 'application/json',
          'idempotency-key': `tei-${key}`,
        },
        body: JSON.stringify(input),
      }),
    );
    const body = (await response.json()) as Record<string, any>;
    expect(response.status, `${String(input.commandType)}: ${JSON.stringify(body)}`).toBeLessThan(
      300,
    );
    return body;
  }

  // ---- Customers (company level) ----
  const customers = [
    { reference: 'TEI-C001', name: 'Matabeleland Haulage', limit: '6000.0000' },
    { reference: 'TEI-C002', name: 'City Council Fleet', limit: '12000.0000' },
    { reference: 'TEI-C003', name: 'Greenfields Farm Co-op', limit: '2500.0000' },
  ];
  const creditAccounts: string[] = [];
  for (const customer of customers) {
    const created = await call(
      'customer',
      {
        commandType: 'CreateCustomer',
        tenantId,
        accountReference: customer.reference,
        displayName: customer.name,
        legalEntityId: legalId,
      },
      `${customer.reference}-create`,
      'owner',
    );
    const account = await call(
      'customer',
      {
        commandType: 'CreateCustomerAccount',
        tenantId,
        customerId: created.customerId,
        accountType: 'CREDIT',
        currency: 'USD',
        stationScope: 'ALL',
        creditLimit: customer.limit,
      },
      `${customer.reference}-account`,
      'owner',
    );
    creditAccounts.push(account.accountId as string);
  }

  // ---- Each station: shifts, pumps, tanks, prices, opening stock, cash locations, go-live ----
  const stationState = [] as {
    stationId: string;
    tillId: string;
    safeId: string;
    tankDiesel: string;
    tankPetrol: string;
    nozzleDiesel: string;
    nozzlePetrol: string;
    installDiesel: string;
    installPetrol: string;
    priceDiesel: string;
    pricePetrol: string;
    templateId: string;
  }[];
  for (const station of stations) {
    const n = station.index * 100;
    const stationId = id(10 + station.index);
    const supervisorMembership = membershipId(station.supervisor);
    const ownerMembership = membershipId('owner');
    const s = {
      stationId,
      tillId: id(20, n + 1),
      safeId: id(20, n + 2),
      tankDiesel: id(21, n + 1),
      tankPetrol: id(21, n + 2),
      nozzleDiesel: id(22, n + 1),
      nozzlePetrol: id(22, n + 2),
      installDiesel: id(23, n + 1),
      installPetrol: id(23, n + 2),
      priceDiesel: id(24, n + 1),
      pricePetrol: id(24, n + 2),
      templateId: id(25, n + 1),
    };
    stationState.push(s);
    const fuels = [
      [
        '1',
        dieselProduct,
        s.tankDiesel,
        s.nozzleDiesel,
        s.installDiesel,
        s.priceDiesel,
        DIESEL_PRICE,
        station.openingDiesel,
        50000,
        'T1',
        'D',
      ],
      [
        '2',
        petrolProduct,
        s.tankPetrol,
        s.nozzlePetrol,
        s.installPetrol,
        s.pricePetrol,
        PETROL_PRICE,
        station.openingPetrol,
        40000,
        'T2',
        'P',
      ],
    ] as const;
    for (const [
      pumpNo,
      product,
      tank,
      nozzle,
      installation,
      price,
      unit,
      opening,
      capacity,
      tankCode,
      letter,
    ] of fuels) {
      const pump = id(26, n + Number(pumpNo));
      const meter = id(27, n + Number(pumpNo));
      await client.unsafe(`
        insert into app.pumps (id, tenant_id, station_id, number, status) values ('${pump}', '${tenantId}', '${stationId}', '${pumpNo}', 'ACTIVE');
        insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
          values ('${nozzle}', '${tenantId}', '${stationId}', '${pump}', '1', '${product}', 'ACTIVE');
        insert into app.meters (id, tenant_id, serial_number) values ('${meter}', '${tenantId}', 'TEI-${station.code}-${letter}');
        insert into app.meter_installations (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
          values ('${installation}', '${tenantId}', '${stationId}', '${nozzle}', '${meter}', '2020-01-01T00:00:00Z', '${supervisorMembership}');
        insert into app.selling_prices (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
          values ('${price}', '${tenantId}', '${stationId}', '${product}', '2020-01-01T00:00:00Z', ${unit.toFixed(6)}, 'DRAFT', '${supervisorMembership}');
        update app.selling_prices set state='PENDING_APPROVAL' where id='${price}';
        update app.selling_prices set state='APPROVED', approved_by='${ownerMembership}', approved_at=now() where id='${price}';
        update app.selling_prices set state='PENDING_STATION_ACTIVATION' where id='${price}';
        update app.selling_prices set state='BOUNDARIES_IN_PROGRESS' where id='${price}';
        update app.selling_prices set state='ACTIVE', activated_at=now() where id='${price}';
        insert into app.tanks (id, tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres, acceptable_variance_litres, status, created_by, updated_by)
          values ('${tank}', '${tenantId}', '${stationId}', '${tankCode}', '${product}', ${capacity}, ${Math.round(capacity * 0.08)}, 50, 'ACTIVE', '${supervisorMembership}', '${supervisorMembership}');
        insert into app.inventory_movements (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
          values ('${id(28, n + Number(pumpNo))}', '${tenantId}', '${stationId}', '${tank}', '${product}', 'OPENING_BALANCE', ${opening}, '${dayBefore(firstDate)}T05:00:00Z', '${dayBefore(firstDate)}', 'CUTOVER', '${id(28, n + Number(pumpNo))}', '${supervisorMembership}');
      `);
      // Stock that is in a tank but has no cost cannot be valued, so every opening quantity gets one.
      await call(
        'inventory',
        {
          commandType: 'RecordOpeningInventoryCost',
          tenantId,
          stationId,
          tankId: tank,
          amount: (opening * (letter === 'D' ? 1.18 : 1.3)).toFixed(4),
          currency: 'USD',
        },
        `${station.code}-${letter}-opening-cost`,
        'owner',
      );
    }
    await client.unsafe(`
      insert into app.cash_locations (id, tenant_id, station_id, code, name, location_type) values
        ('${s.tillId}', '${tenantId}', '${stationId}', 'TILL', 'Station till', 'STATION_TILL'),
        ('${s.safeId}', '${tenantId}', '${stationId}', 'SAFE', 'Station safe', 'STATION_SAFE');
      insert into app.shift_templates (id, tenant_id, station_id, code, name, start_time, duration_minutes, active, created_by)
        values ('${s.templateId}', '${tenantId}', '${stationId}', 'DAY', 'Day shift', '06:00', 720, true, '${supervisorMembership}');
    `);
    // Going live the way an owner does: this also gives the company its standard expense categories.
    await call(
      'forecourt',
      { commandType: 'ActivateStation', tenantId, stationId },
      `${station.code}-activate`,
      'owner',
    );
  }

  // ---- Thirty days of daily operations, both stations ----
  const stationContext = (stationId: string) => ({
    organisationId: tenantId,
    legalEntityId: legalId,
    stationId,
    allStations: false,
  });
  const add = (a: string, b: number) => (Number(a) + b).toFixed(3);

  for (const [stationIndex, station] of stations.entries()) {
    const s = stationState[stationIndex]!;
    const stationId = s.stationId;
    const supervisor: Who = station.supervisor;
    const attendantMembership = membershipId(station.attendant);
    const nextReading = async (nozzleId: string) => {
      const rows = await client<{ reading_value: string }[]>`
        select reading_value from app.meter_boundaries
        where tenant_id=${tenantId} and nozzle_id=${nozzleId} and reading_status='AVAILABLE'
        order by effective_at desc, id desc limit 1`;
      return rows[0]?.reading_value ?? (station.index === 0 ? '100000.000' : '240000.000');
    };

    for (const [index, date] of dates.entries()) {
      const dayNumber = index + 1 + station.index * 7;
      const tag = `${station.code}-${date}`;
      const isLast = index === dates.length - 1;
      const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
      const dieselLitres = Math.round(
        station.dieselLitres * (weekend ? 0.8 : 1) + Math.sin(dayNumber * 1.3) * 70,
      );
      const petrolLitres = Math.round(
        station.petrolLitres * (weekend ? 0.85 : 1) + Math.cos(dayNumber * 0.9) * 55,
      );
      const total = dieselLitres * DIESEL_PRICE + petrolLitres * PETROL_PRICE;

      const dayId = randomUUID();
      await client.unsafe(`
        insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
          values ('${dayId}', '${tenantId}', '${stationId}', '${date}', 'NOT_STARTED');
        update app.station_business_days set state='OPEN', opened_at=now() where id='${dayId}';
      `);
      const shiftId = randomUUID();
      const reconciliationId = randomUUID();
      const common = { tenantId, stationId, reconciliationId };
      await call(
        'forecourt',
        {
          commandType: 'StartShift',
          tenantId,
          stationId,
          businessDayId: dayId,
          shiftId,
          expectedVersion: 0,
          plannedStartAt: `${date}T04:00:00.000Z`,
          shiftTemplateId: s.templateId,
        },
        `${tag}-shift`,
        supervisor,
      );
      await call(
        'forecourt',
        {
          commandType: 'CreateProductionReconciliation',
          ...common,
          businessDayId: dayId,
          shiftId,
          expectedVersion: 0,
        },
        `${tag}-create`,
        supervisor,
      );
      const [shift] = await client<{ version: number }[]>`
        select version from app.shifts where tenant_id=${tenantId} and id=${shiftId}`;

      const readings: {
        nozzleId: string;
        productId: string;
        priceId: string;
        opening: string;
        closing: string;
      }[] = [];
      for (const [name, fuel, litres] of [
        [
          'diesel',
          {
            nozzle: s.nozzleDiesel,
            product: dieselProduct,
            installation: s.installDiesel,
            price: s.priceDiesel,
          },
          dieselLitres,
        ],
        [
          'petrol',
          {
            nozzle: s.nozzlePetrol,
            product: petrolProduct,
            installation: s.installPetrol,
            price: s.pricePetrol,
          },
          petrolLitres,
        ],
      ] as const) {
        const opening = await nextReading(fuel.nozzle);
        const closing = add(opening, litres);
        const boundaryIds: string[] = [];
        for (const [i, readingValue] of [opening, closing].entries()) {
          const boundaryId = randomUUID();
          boundaryIds.push(boundaryId);
          await call(
            'forecourt',
            {
              commandType: 'ConfirmBoundary',
              tenantId,
              stationId,
              boundaryId,
              nozzleId: fuel.nozzle,
              meterInstallationId: fuel.installation,
              businessDayId: dayId,
              shiftId,
              responsibleAttendantId: membershipId(station.attendant),
              reason: i === 0 ? 'SHIFT_OPEN' : 'SHIFT_CLOSE',
              readingStatus: 'AVAILABLE',
              readingValue,
              ...(i === 0 ? { exceptionReason: 'Opening reading carried over' } : {}),
              expectedVersion: shift!.version,
            },
            `${tag}-${name}-boundary-${i}`,
            supervisor,
          );
          await client.unsafe('select pg_sleep(0.01)');
        }
        // The application stamps a reading with the moment it is confirmed. A seeded past day has to
        // sit inside its own shift instead, so the two readings are moved to that day. Only this
        // disposable local database allows it (readings are protected by a trigger everywhere else).
        await client.begin(async (tx) => {
          await tx.unsafe('set local session_replication_role = replica');
          for (const [i, boundaryId] of boundaryIds.entries()) {
            const at = `${date}T${i === 0 ? '04:30' : '15:30'}:00Z`;
            await tx`update app.meter_boundaries set effective_at=${at}::timestamptz, confirmed_at=${at}::timestamptz where id=${boundaryId}`;
          }
        });
        const boundaries = await client<{ id: string; effective_at: Date }[]>`
          select id, effective_at from app.meter_boundaries
          where tenant_id=${tenantId} and id in ${client(boundaryIds)} order by effective_at, id`;
        const open = boundaries.find((b) => b.id === boundaryIds[0])!;
        const close = boundaries.find((b) => b.id === boundaryIds[1])!;
        await call(
          'forecourt',
          {
            commandType: 'SealSegment',
            tenantId,
            stationId,
            segmentId: randomUUID(),
            nozzleId: fuel.nozzle,
            meterInstallationId: fuel.installation,
            businessDayId: dayId,
            shiftId,
            openingBoundaryId: open.id,
            closingBoundaryId: close.id,
            productId: fuel.product,
            responsibleAttendantId: attendantMembership,
            startAt: open.effective_at.toISOString(),
            endAt: close.effective_at.toISOString(),
            expectedVersion: 0,
          },
          `${tag}-${name}-segment`,
          supervisor,
        );
        readings.push({
          nozzleId: fuel.nozzle,
          productId: fuel.product,
          priceId: fuel.price,
          opening,
          closing,
        });
      }

      let version = 0;
      const save = async (input: Record<string, unknown>, key: string) => {
        const body = await call(
          'forecourt',
          { ...input, ...common, expectedVersion: version },
          `${tag}-${key}`,
          supervisor,
        );
        version += 1;
        return body;
      };
      await save(
        { commandType: 'SetAttendants', attendantIds: [attendantMembership] },
        'attendants',
      );
      await save(
        {
          commandType: 'SaveMeterReadings',
          readings: readings.map((r) => ({
            nozzleId: r.nozzleId,
            productId: r.productId,
            shiftId,
            openingReading: r.opening,
            closingReading: r.closing,
            sellingPriceId: r.priceId,
          })),
        },
        'readings',
      );

      // Payments add up to the day's sales: some on credit, some card and mobile, the rest cash.
      const credit = dayNumber % 4 === 0 ? 120 : 0;
      const pos = Math.round(total * 0.2 * 100) / 100;
      const eco = Math.round(total * 0.1 * 100) / 100;
      const cash = Math.round((total - credit - pos - eco) * 100) / 100;
      await save(
        {
          commandType: 'SavePaymentAllocations',
          payments: [
            { method: 'CASH', amount: cash.toFixed(2) },
            { method: 'POS', amount: pos.toFixed(2) },
            { method: 'ECOCASH', amount: eco.toFixed(2) },
            ...(credit
              ? [
                  {
                    method: 'CUSTOMER_CREDIT',
                    amount: credit.toFixed(2),
                    customerAccountId: creditAccounts[dayNumber % creditAccounts.length],
                  },
                ]
              : []),
          ],
        },
        'payments',
      );
      const cashExpenses = [
        { category: 'Fuel transport', description: 'Cartage and delivery fee', amount: '20.00' },
        ...(dayNumber % 3 === 0
          ? [{ category: 'Maintenance', description: 'Pump nozzle seal', amount: '12.50' }]
          : []),
      ].map((e) => ({ ...e, paymentMethod: 'CASH' }));
      await save({ commandType: 'SaveExpenses', expenses: cashExpenses }, 'expenses');

      // Dips taken at close: the stock the books expect, with a small wobble on some days.
      const dips: { dipId: string; tankId: string; productId: string }[] = [];
      let stockOff = false;
      for (const [tankId, productId, sold] of [
        [s.tankDiesel, dieselProduct, dieselLitres],
        [s.tankPetrol, petrolProduct, petrolLitres],
      ] as const) {
        const [row] = await client<{ expected: string }[]>`
          select coalesce(sum(quantity_litres),0)::text as expected from app.inventory_movements
          where tenant_id=${tenantId} and station_id=${stationId} and tank_id=${tankId}`;
        const drift = dayNumber % 5 === 0 ? (tankId === s.tankDiesel ? -18 : 9) : 0;
        if (drift) stockOff = true;
        const physical = (Number(row!.expected) - sold + drift).toFixed(3);
        const dipId = randomUUID();
        await client`
          insert into app.tank_dips (id, tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by)
          values (${dipId}, ${tenantId}, ${stationId}, ${tankId}, ${`${date}T18:30:00Z`}, ${date}, ${physical}, ${membershipId(station.supervisor)})`;
        dips.push({ dipId, tankId, productId });
      }
      await save({ commandType: 'LinkTankDips', dips }, 'dips');

      const cashVarianceDay = dayNumber % 6 === 0;
      const netCash = cash - cashExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
      const counted = netCash - (cashVarianceDay ? 5 : 0);
      await save({ commandType: 'SaveCashDeclaration', countedCash: counted.toFixed(2) }, 'cash');
      await save(
        {
          commandType: 'SaveVarianceExplanations',
          explanations: {
            ...(stockOff
              ? { STOCK: 'Dipstick rounding and temperature; within what the station sees weekly.' }
              : {}),
            ...(cashVarianceDay
              ? { CASH: 'US$5 short at the count; the attendant will repay it.' }
              : {}),
          },
        },
        'explanations',
      );
      await call(
        'forecourt',
        { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: version },
        `${tag}-submit`,
        supervisor,
      );
      // The latest day stays submitted so there is something to approve.
      if (isLast) continue;
      await call(
        'forecourt',
        {
          commandType: 'ApproveProductionReconciliation',
          ...common,
          expectedVersion: version + 1,
        },
        `${tag}-approve`,
        'owner',
      );

      // Cash handled the next morning: collected from the till into the safe; every third day banked.
      const collected = await call(
        'cash',
        {
          commandType: 'RecordCashCollection',
          context: stationContext(stationId),
          collectionReference: `${station.code}-COL-${date}`,
          sourceLocationId: s.tillId,
          sources: [{ reconciliationId, amount: counted.toFixed(2) }],
        },
        `${tag}-collect`,
        'finance',
      );
      if (index < dates.length - 3) {
        await call(
          'cash',
          {
            commandType: 'ReceiveCashCollection',
            context: stationContext(stationId),
            collectionId: collected.collectionId,
            targetLocationId: s.safeId,
            expectedVersion: 0,
          },
          `${tag}-receive`,
          // The person who recorded the cash may not also receive it.
          'owner',
        );
        // Cash is banked the day after it is received, except for the last few days, which still
        // sit in the safe. The bank confirms every deposit older than a week; one of them comes in
        // five dollars short, with the reason the bank gave.
        if (index < dates.length - 6) {
          const deposit = await call(
            'cash',
            {
              commandType: 'CreateBankDeposit',
              context: stationContext(stationId),
              bankAccountId: bankId,
              sourceLocationId: s.safeId,
              depositReference: `${station.code}-DEP-${date}`,
              allocations: [{ collectionId: collected.collectionId, amount: counted.toFixed(2) }],
            },
            `${tag}-deposit`,
            'finance',
          );
          if (index < dates.length - 9) {
            const short = index === 12;
            // The bank step needs a deposit slip on file. The seed records the slip's details; there
            // is no stored file behind it, so opening the slip itself shows nothing.
            await client`
              insert into app.documents
                (tenant_id, legal_entity_id, station_id, subject_type, subject_id, kind, object_key, file_name, content_type, byte_size, sha256, uploaded_by)
              values (${tenantId}, ${legalId}, ${stationId}, 'BANK_DEPOSIT', ${deposit.depositId}, 'DEPOSIT_SLIP',
                ${`demo/${station.code}-DEP-${date}.pdf`}, ${`${station.code}-DEP-${date}.pdf`}, 'application/pdf', 1024,
                ${'0'.repeat(64)}, ${membershipId('finance')})`;
            await call(
              'cash',
              {
                commandType: 'ConfirmBankDeposit',
                context: stationContext(stationId),
                depositId: deposit.depositId,
                expectedVersion: 0,
                confirmedAmount: (counted - (short ? 5 : 0)).toFixed(2),
                bankReference: `${station.code}-BANK-${date}`,
                bankDate: dates[index + 1],
                ...(short
                  ? { differenceReason: 'The bank counted five dollars less than we sent.' }
                  : {}),
              },
              `${tag}-confirm`,
              'owner',
            );
          }
        }
      }

      // Days older than three are closed and locked, the way a month-end station would be.
      if (index < dates.length - 4) {
        const [now] = await client<
          { shiftVersion: number; revisionVersion: number; dayVersion: number }[]
        >`
          select
            (select version from app.shifts where tenant_id=${tenantId} and id=${shiftId}) as "shiftVersion",
            (select version from app.reconciliation_revisions where tenant_id=${tenantId} and reconciliation_id=${reconciliationId} order by revision desc limit 1) as "revisionVersion",
            (select version from app.station_business_days where tenant_id=${tenantId} and id=${dayId}) as "dayVersion"`;
        const [revision] = await client<{ id: string }[]>`
          select id from app.reconciliation_revisions
          where tenant_id=${tenantId} and reconciliation_id=${reconciliationId}
          order by revision desc limit 1`;
        const lifecycle = { tenantId, stationId, businessDayId: dayId, shiftId };
        await call(
          'forecourt',
          { commandType: 'CloseMeters', ...lifecycle, expectedVersion: now!.shiftVersion },
          `${tag}-close-meters`,
          supervisor,
        );
        await call(
          'forecourt',
          { commandType: 'CompleteShift', ...lifecycle, expectedVersion: now!.shiftVersion + 1 },
          `${tag}-complete-shift`,
          supervisor,
        );
        await call(
          'forecourt',
          {
            commandType: 'PostReconciliation',
            tenantId,
            stationId,
            revisionId: revision!.id,
            expectedVersion: now!.revisionVersion,
          },
          `${tag}-post`,
          'owner',
        );
        await call(
          'forecourt',
          {
            commandType: 'LockReconciliation',
            tenantId,
            stationId,
            revisionId: revision!.id,
            expectedVersion: now!.revisionVersion + 1,
          },
          `${tag}-lock-reconciliation`,
          'owner',
        );
        await call(
          'forecourt',
          {
            commandType: 'CloseBusinessDay',
            tenantId,
            stationId,
            businessDayId: dayId,
            expectedVersion: now!.dayVersion,
          },
          `${tag}-close-day`,
          'owner',
        );
        await call(
          'forecourt',
          {
            commandType: 'LockBusinessDay',
            tenantId,
            stationId,
            businessDayId: dayId,
            expectedVersion: now!.dayVersion + 2,
          },
          `${tag}-lock-day`,
          'owner',
        );
      }
    }
  }

  // ---- Suppliers and fixed costs (company level, named to the first station) ----
  const supplierRows = [
    ['PUMA-001', 'Puma Energy Zimbabwe', 'TI-20458', 9, '14400.0000', '12000', '1.20'],
    ['ZUVA-001', 'Zuva Petroleum', 'ZP-3402', 20, '8050.0000', '7000', '1.15'],
  ] as const;
  for (const [code, legalName, reference, daysAgo, amount, quantity, unitPrice] of supplierRows) {
    const supplier = await call(
      'supplier',
      { tenantId, legalEntityId: legalId, commandType: 'CreateSupplier', code, legalName },
      `supplier-${code}`,
      'finance',
    );
    const invoice = await call(
      'supplier',
      {
        tenantId,
        legalEntityId: legalId,
        commandType: 'SubmitSupplierDocument',
        supplierId: supplier.supplierId,
        documentType: 'INVOICE',
        referenceNumber: reference,
        documentDate: stationDate(-daysAgo),
        paymentTerms: 'CREDIT',
        creditPeriodDays: 14,
        amount,
        lines: [{ description: 'Fuel delivery', quantity, unitPrice }],
      },
      `invoice-${reference}`,
      'finance',
    );
    await call(
      'supplier',
      {
        tenantId,
        legalEntityId: legalId,
        commandType: 'PostSupplierDocument',
        documentId: invoice.documentId,
        expectedVersion: 0,
      },
      `invoice-post-${reference}`,
      'finance',
    );
  }

  const fixedCosts = [
    ['RENT', 'Rent', 'Monthly station rent', '1800.0000'],
    ['WAGES', 'Wages', 'Monthly staff wages', '3600.0000'],
  ] as const;
  const monthStart = `${lastDate.slice(0, 8)}01`;
  const [primary] = stationState;
  for (const [code, categoryName, name, amount] of fixedCosts) {
    const category = await call(
      'expense',
      {
        commandType: 'CreateExpenseCategory',
        tenantId,
        legalEntityId: legalId,
        code,
        name: categoryName,
        classification: 'FIXED_COST',
      },
      `category-${code}`,
      'finance',
    );
    const template = await call(
      'expense',
      {
        commandType: 'CreateRecurringCostTemplate',
        tenantId,
        stationId: primary!.stationId,
        categoryId: category.categoryId,
        name,
        amount,
        startDate: firstDate < monthStart ? firstDate.slice(0, 8) + '01' : monthStart,
      },
      `template-${code}`,
      'finance',
    );
    const period = await call(
      'expense',
      {
        commandType: 'GenerateRecurringCostPeriod',
        tenantId,
        stationId: primary!.stationId,
        templateId: template.templateId,
        periodStart: monthStart,
      },
      `period-${code}`,
      'finance',
    );
    await call(
      'expense',
      {
        commandType: 'RecognizeRecurringCost',
        tenantId,
        stationId: primary!.stationId,
        periodId: period.periodId,
        recognitionDate: lastDate,
      },
      `recognise-${code}`,
      'finance',
    );
  }
}
