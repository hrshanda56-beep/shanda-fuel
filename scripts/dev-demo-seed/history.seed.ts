/**
 * Local demo history: petrol alongside diesel, and about three weeks of daily reconciliations with
 * tank dips, expenses, credit sales, cash collections and a few bank deposits, so the dashboard,
 * the Station Daily Report, stock and cash screens have something to show.
 *
 * It drives the real commands, like the other demo seeds, and must run after them (it needs the
 * DEV1 station, the diesel nozzle, the customers and the Finance demo's cash locations):
 *
 *   DATABASE_URL=<direct local url> pnpm exec vitest run --config vitest.dev-seed.config.ts history.seed
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
import { POST as supplierPost } from '../../src/app/api/suppliers/commands/route';

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
  supplier: supplierPost,
} as const;
const paths = {
  forecourt: 'forecourt',
  inventory: 'inventory',
  cash: 'cash',
  supplier: 'suppliers',
} as const;

// Created by demo.seed.ts.
const diesel = {
  product: 'd1000000-0000-4000-8000-000000000003',
  nozzle: 'd1000000-0000-4000-8000-000000000005',
  installation: 'd1000000-0000-4000-8000-000000000007',
  price: 'd1000000-0000-4000-8000-000000000008',
  tank: 'd1000000-0000-4000-8000-000000000010',
};
const attendant = 'd1000000-0000-4000-8000-000000000002';
const till = 'd1000000-0000-4000-8000-000000000013';
const safe = 'd1000000-0000-4000-8000-000000000014';
const bank = 'd1000000-0000-4000-8000-000000000015';
const shiftTemplate = 'd1000000-0000-4000-8000-000000000016';
// Created here.
const petrol = {
  product: 'e1000000-0000-4000-8000-000000000003',
  pump: 'e1000000-0000-4000-8000-000000000004',
  nozzle: 'e1000000-0000-4000-8000-000000000005',
  meter: 'e1000000-0000-4000-8000-000000000006',
  installation: 'e1000000-0000-4000-8000-000000000007',
  price: 'e1000000-0000-4000-8000-000000000008',
  tank: 'e1000000-0000-4000-8000-000000000010',
  opening: 'e1000000-0000-4000-8000-000000000011',
};

const DIESEL_PRICE = 1.5;
const PETROL_PRICE = 1.65;
const skipDates = new Set(['2026-10-26']); // yesterday is seeded by the Finance demo
const firstDate = '2026-10-01';
const lastDate = '2026-10-24';

type Who = 'owner' | 'supervisor' | 'finance';

describe.skipIf(!loopback)('local demo history', () => {
  it('seeds petrol and three weeks of daily operations', async () => {
    if (process.env.APP_ENV !== 'local')
      throw new Error('The history seed only runs with APP_ENV=local');
    const client: Sql = postgres(databaseUrl, { max: 1, prepare: false });
    try {
      await run(client);
    } finally {
      await client.end();
    }
  });
});

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`);) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

async function run(client: Sql) {
  const [tenant] = await client<
    { id: string }[]
  >`select id from app.tenants where slug='shanda-dev'`;
  const [station] = await client<{ id: string; legal_entity_id: string }[]>`
    select id, legal_entity_id from app.stations where tenant_id=${tenant!.id} and code='DEV1'`;
  if (!tenant || !station) throw new Error('Run the owner and Finance demo seeds first');
  const tenantId = tenant.id;
  const stationId = station.id;
  const legalId = station.legal_entity_id;
  const [already] = await client`select 1 from app.products where id=${petrol.product}`;
  if (already)
    throw new Error('History already seeded. Recreate the local database to seed again.');

  const people = await client<
    { provider_user_id: string; user_id: string; membership_id: string; role: string }[]
  >`
    select ai.provider_user_id, u.id as user_id, m.id as membership_id, a.role_code as role
    from app.memberships m
    join app.users u on u.id = m.identity_id
    join app.auth_identities ai on ai.internal_user_id = u.id and ai.provider='CLERK'
    join app.membership_role_assignments a on a.membership_id = m.id
    where m.tenant_id=${tenantId}`;
  const byRole = (role: string) => {
    const row = people.find((p) => p.role === role);
    if (!row) throw new Error(`Seed a ${role} user first`);
    return row;
  };
  const actors = {
    owner: byRole('OWNER'),
    supervisor: byRole('SUPERVISOR'),
    finance: byRole('FINANCE'),
  };
  const tokens = {} as Record<Who, string>;
  for (const who of ['owner', 'supervisor', 'finance'] as const) {
    const sessionId = randomUUID();
    tokens[who] = `history-${who}-token`;
    clerkFixtures.sessions.set(tokens[who], {
      id: sessionId,
      userId: actors[who].provider_user_id,
      internalUserId: actors[who].user_id,
      expiresAt: new Date('2030-01-01T00:00:00Z'),
      factorVerificationAge: [0, 0],
      revoked: false,
    });
    await seedActiveStepUp(client, sessionId, tenantId);
  }
  const supervisorMembership = actors.supervisor.membership_id;

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
          'idempotency-key': `history-${key}`,
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

  // Petrol: product, pump, nozzle, meter, price, tank and opening stock.
  await client.unsafe(`
    insert into app.products (id, tenant_id, code, name) values ('${petrol.product}', '${tenantId}', 'PETROL', 'Unleaded Petrol');
    insert into app.pumps (id, tenant_id, station_id, number, status) values ('${petrol.pump}', '${tenantId}', '${stationId}', '2', 'ACTIVE');
    insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
      values ('${petrol.nozzle}', '${tenantId}', '${stationId}', '${petrol.pump}', '1', '${petrol.product}', 'ACTIVE');
    insert into app.meters (id, tenant_id, serial_number) values ('${petrol.meter}', '${tenantId}', 'DEMO-METER-2');
    insert into app.meter_installations (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
      values ('${petrol.installation}', '${tenantId}', '${stationId}', '${petrol.nozzle}', '${petrol.meter}', '2020-01-01T00:00:00Z', '${supervisorMembership}');
    insert into app.selling_prices (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
      values ('${petrol.price}', '${tenantId}', '${stationId}', '${petrol.product}', '2020-01-01T00:00:00Z', ${PETROL_PRICE.toFixed(6)}, 'DRAFT', '${supervisorMembership}');
    update app.selling_prices set state='PENDING_APPROVAL' where id='${petrol.price}';
    update app.selling_prices set state='APPROVED', approved_by='${actors.owner.membership_id}', approved_at=now() where id='${petrol.price}';
    update app.selling_prices set state='PENDING_STATION_ACTIVATION' where id='${petrol.price}';
    update app.selling_prices set state='BOUNDARIES_IN_PROGRESS' where id='${petrol.price}';
    update app.selling_prices set state='ACTIVE', activated_at=now() where id='${petrol.price}';
    insert into app.tanks (id, tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres, acceptable_variance_litres, status, created_by, updated_by)
      values ('${petrol.tank}', '${tenantId}', '${stationId}', 'T2', '${petrol.product}', 30000, 3000, 50, 'ACTIVE', '${supervisorMembership}', '${supervisorMembership}');
    insert into app.inventory_movements (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
      values ('${petrol.opening}', '${tenantId}', '${stationId}', '${petrol.tank}', '${petrol.product}', 'OPENING_BALANCE', 15000, '2026-09-30T05:00:00Z', '2026-09-30', 'CUTOVER', '${petrol.opening}', '${supervisorMembership}');
  `);
  await call(
    'inventory',
    {
      commandType: 'RecordOpeningInventoryCost',
      tenantId,
      stationId,
      tankId: petrol.tank,
      amount: '14250.0000',
      currency: 'USD',
    },
    'petrol-opening-cost',
    'owner',
  );

  const [creditAccount] = await client<{ id: string }[]>`
    select a.id from app.customer_accounts a
    where a.tenant_id=${tenantId} and a.account_type='CREDIT' and a.status='ACTIVE'
    order by a.created_at limit 1`;

  const nextReading = async (nozzleId: string) => {
    const rows = await client<{ reading_value: string }[]>`
      select reading_value from app.meter_boundaries
      where tenant_id=${tenantId} and nozzle_id=${nozzleId} and reading_status='AVAILABLE'
      order by effective_at desc, id desc limit 1`;
    return rows[0]?.reading_value ?? '100000.000';
  };
  const add = (a: string, b: number) => (Number(a) + b).toFixed(3);
  const stationContext = {
    organisationId: tenantId,
    legalEntityId: legalId,
    stationId,
    allStations: false,
  };

  const dates = datesBetween(firstDate, lastDate).filter((d) => !skipDates.has(d));
  let dayNumber = 0;
  for (const [index, date] of dates.entries()) {
    dayNumber += 1;
    const tag = `d${date}`;
    const isLast = index === dates.length - 1;
    const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
    // Deterministic wobble so the chart is not a flat line.
    const wave = Math.sin(dayNumber * 1.3);
    const dieselLitres = Math.round((weekend ? 540 : 700) + wave * 90);
    const petrolLitres = Math.round((weekend ? 420 : 520) + Math.cos(dayNumber * 0.9) * 70);
    const dieselSales = dieselLitres * DIESEL_PRICE;
    const petrolSales = petrolLitres * PETROL_PRICE;

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
        shiftTemplateId: shiftTemplate,
      },
      `${tag}-shift`,
      'supervisor',
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
      'supervisor',
    );
    const [shift] = await client<{ version: number }[]>`
      select version from app.shifts where tenant_id=${tenantId} and id=${shiftId}`;

    const readings: {
      nozzleId: string;
      productId: string;
      installation: string;
      priceId: string;
      opening: string;
      closing: string;
    }[] = [];
    for (const [n, fuel, litres] of [
      [
        'diesel',
        {
          nozzle: diesel.nozzle,
          product: diesel.product,
          installation: diesel.installation,
          price: diesel.price,
        },
        dieselLitres,
      ],
      [
        'petrol',
        {
          nozzle: petrol.nozzle,
          product: petrol.product,
          installation: petrol.installation,
          price: petrol.price,
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
            responsibleAttendantId: attendant,
            reason: i === 0 ? 'SHIFT_OPEN' : 'SHIFT_CLOSE',
            readingStatus: 'AVAILABLE',
            readingValue,
            ...(i === 0 ? { exceptionReason: 'Demo data' } : {}),
            expectedVersion: shift!.version,
          },
          `${tag}-${n}-boundary-${i}`,
          'supervisor',
        );
        await client.unsafe('select pg_sleep(0.01)');
      }
      const boundaries = await client<{ id: string; effective_at: Date }[]>`
        select id, effective_at from app.meter_boundaries where tenant_id=${tenantId} and id in ${client(boundaryIds)} order by effective_at, id`;
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
          responsibleAttendantId: attendant,
          startAt: open.effective_at.toISOString(),
          endAt: close.effective_at.toISOString(),
          expectedVersion: 0,
        },
        `${tag}-${n}-segment`,
        'supervisor',
      );
      readings.push({
        nozzleId: fuel.nozzle,
        productId: fuel.product,
        installation: fuel.installation,
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
        'supervisor',
      );
      version += 1;
      return body;
    };
    await save({ commandType: 'SetAttendants', attendantIds: [attendant] }, 'attendants');
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
    const total = dieselSales + petrolSales;
    const credit = creditAccount && dayNumber % 4 === 0 ? 80 : 0;
    const pos = Math.round(total * 0.22 * 100) / 100;
    const eco = Math.round(total * 0.08 * 100) / 100;
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
                  customerAccountId: creditAccount!.id,
                },
              ]
            : []),
        ],
      },
      'payments',
    );
    const cashExpenses = [
      { category: 'Transport', description: 'Cartage and delivery fee', amount: '20.00' },
      ...(dayNumber % 3 === 0
        ? [{ category: 'Repairs', description: 'Pump nozzle seal', amount: '12.50' }]
        : []),
    ].map((e) => ({ ...e, paymentMethod: 'CASH' }));
    await save({ commandType: 'SaveExpenses', expenses: cashExpenses }, 'expenses');

    // Dips taken at close: the stock the books expect, with a small wobble on some days.
    const dipTankIds: { dipId: string; tankId: string; productId: string }[] = [];
    let stockOff = false;
    for (const [tankId, productId, sold] of [
      [diesel.tank, diesel.product, dieselLitres],
      [petrol.tank, petrol.product, petrolLitres],
    ] as const) {
      const [row] = await client<{ expected: string }[]>`
        select coalesce(sum(quantity_litres),0)::text as expected from app.inventory_movements
        where tenant_id=${tenantId} and station_id=${stationId} and tank_id=${tankId}`;
      const drift = dayNumber % 5 === 0 ? (tankId === diesel.tank ? -18 : 9) : 0;
      if (drift) stockOff = true;
      const physical = (Number(row!.expected) - sold + drift).toFixed(3);
      const dipId = randomUUID();
      await client`
        insert into app.tank_dips (id, tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by)
        values (${dipId}, ${tenantId}, ${stationId}, ${tankId}, ${`${date}T18:30:00Z`}, ${date}, ${physical}, ${supervisorMembership})`;
      dipTankIds.push({ dipId, tankId, productId });
    }
    await save({ commandType: 'LinkTankDips', dips: dipTankIds }, 'dips');

    const cashVarianceDay = dayNumber % 6 === 0;
    const netCash = cash - cashExpenses.reduce((s, e) => s + Number(e.amount), 0);
    await save(
      {
        commandType: 'SaveCashDeclaration',
        countedCash: (netCash - (cashVarianceDay ? 5 : 0)).toFixed(2),
      },
      'cash',
    );
    await save(
      {
        commandType: 'SaveVarianceExplanations',
        explanations: {
          ...(stockOff
            ? {
                STOCK:
                  'Dip reading differs slightly from the meters; temperature and dipstick rounding.',
              }
            : {}),
          ...(cashVarianceDay
            ? { CASH: 'US$5 short at count; attendant to repay from salary.' }
            : {}),
        },
      },
      'explanations',
    );
    await call(
      'forecourt',
      { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: version },
      `${tag}-submit`,
      'supervisor',
    );

    // The latest day stays submitted so there is something to approve.
    if (isLast) continue;
    await call(
      'forecourt',
      { commandType: 'ApproveProductionReconciliation', ...common, expectedVersion: version + 1 },
      `${tag}-approve`,
      'owner',
    );

    // Cash handled the next morning: collected from the till into the safe; every third day banked.
    const collected = await call(
      'cash',
      {
        commandType: 'RecordCashCollection',
        context: stationContext,
        collectionReference: `H-COL-${date}`,
        sourceLocationId: till,
        sources: [{ reconciliationId, amount: (netCash - (cashVarianceDay ? 5 : 0)).toFixed(2) }],
      },
      `${tag}-collect`,
      'finance',
    );
    if (index < dates.length - 3) {
      await call(
        'cash',
        {
          commandType: 'ReceiveCashCollection',
          context: stationContext,
          collectionId: collected.collectionId,
          targetLocationId: safe,
          expectedVersion: 0,
        },
        `${tag}-receive`,
        'finance',
      );
      if (index % 3 === 0) {
        await call(
          'cash',
          {
            commandType: 'CreateBankDeposit',
            context: stationContext,
            bankAccountId: bank,
            sourceLocationId: safe,
            depositReference: `H-DEP-${date}`,
            allocations: [
              {
                collectionId: collected.collectionId,
                amount: (netCash - (cashVarianceDay ? 5 : 0)).toFixed(2),
              },
            ],
          },
          `${tag}-deposit`,
          'finance',
        );
      }
    }
  }

  // Two more supplier invoices on credit, one due soon and one not yet.
  const supplier = await call(
    'supplier',
    {
      tenantId,
      legalEntityId: legalId,
      commandType: 'CreateSupplier',
      code: 'ZUVA-001',
      legalName: 'Zuva Petroleum',
    },
    'zuva',
    'finance',
  );
  for (const [ref, docDate, amount, qty, unit] of [
    ['ZP-3381', '2026-10-12', '9500.0000', '9500', '1.00'],
    ['ZP-3402', '2026-10-21', '7400.0000', '8000', '0.925'],
  ] as const) {
    const invoice = await call(
      'supplier',
      {
        tenantId,
        legalEntityId: legalId,
        commandType: 'SubmitSupplierDocument',
        supplierId: supplier.supplierId,
        documentType: 'INVOICE',
        referenceNumber: ref,
        documentDate: docDate,
        paymentTerms: 'CREDIT',
        creditPeriodDays: 14,
        amount,
        lines: [{ description: 'Fuel delivery', quantity: qty, unitPrice: unit }],
      },
      `inv-${ref}`,
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
      `inv-post-${ref}`,
      'finance',
    );
  }
}
