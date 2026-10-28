/**
 * Local demo data for the Finance overview: reconciliations waiting for approval, cash collected
 * and banked, recurring costs with recognition/payment states, a provider settlement with
 * unmatched payments, and a supplier invoice that is overdue.
 *
 * It drives the real commands as the users created by `pnpm db:seed`, so every record is created
 * through the same code paths as the application. Run it once against a fresh local database:
 *
 *   DATABASE_URL=... pnpm db:seed:demo
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
import { POST as settlementPost } from '../../src/app/api/settlements/commands/route';
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
  expense: expensePost,
  settlement: settlementPost,
  supplier: supplierPost,
} as const;
const paths = {
  forecourt: 'forecourt',
  inventory: 'inventory',
  cash: 'cash',
  expense: 'expenses',
  settlement: 'settlements',
  supplier: 'suppliers',
} as const;

// Keep the local fixture aligned with the audit date: yesterday is a complete closed day and
// today is inserted below as a fresh day that an owner can open.
const businessDate = '2026-10-26';
const ids = {
  attendantUser: 'd1000000-0000-4000-8000-000000000001',
  attendant: 'd1000000-0000-4000-8000-000000000002',
  product: 'd1000000-0000-4000-8000-000000000003',
  pump: 'd1000000-0000-4000-8000-000000000004',
  nozzle: 'd1000000-0000-4000-8000-000000000005',
  meter: 'd1000000-0000-4000-8000-000000000006',
  installation: 'd1000000-0000-4000-8000-000000000007',
  price: 'd1000000-0000-4000-8000-000000000008',
  day: 'd1000000-0000-4000-8000-000000000009',
  tank: 'd1000000-0000-4000-8000-000000000010',
  opening: 'd1000000-0000-4000-8000-000000000011',
  dip: 'd1000000-0000-4000-8000-000000000012',
  till: 'd1000000-0000-4000-8000-000000000013',
  safe: 'd1000000-0000-4000-8000-000000000014',
  bank: 'd1000000-0000-4000-8000-000000000015',
  shiftTemplate: 'd1000000-0000-4000-8000-000000000016',
};

type Who = 'owner' | 'supervisor' | 'finance';

describe.skipIf(!loopback)('local demo data', () => {
  it('seeds the Finance demo', async () => {
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

async function run(client: Sql) {
  const [tenant] = await client<
    { id: string }[]
  >`select id from app.tenants where slug='shanda-dev'`;
  const [station] = await client<{ id: string; legal_entity_id: string }[]>`
    select id, legal_entity_id from app.stations where tenant_id=${tenant!.id} and code='DEV1'`;
  if (!tenant || !station) throw new Error('Run the owner seed and create the DEV1 station first');
  const tenantId = tenant.id;
  const stationId = station.id;
  const legalId = station.legal_entity_id;

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

  const [existing] =
    await client`select 1 from app.reconciliations where tenant_id=${tenantId} limit 1`;
  if (existing)
    throw new Error('Demo data already exists. Recreate the local database to seed again.');

  // Sessions for the real users; the command routes still authorise them from the database.
  const tokens = {} as Record<Who, string>;
  for (const who of ['owner', 'supervisor', 'finance'] as const) {
    const sessionId = randomUUID();
    tokens[who] = `demo-${who}-token`;
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
  await client.unsafe(`
    insert into app.users (id, name, email) values ('${ids.attendantUser}', 'Tendai Moyo', 'attendant.demo@example.test');
    insert into app.memberships (id, tenant_id, identity_id, status) values ('${ids.attendant}', '${tenantId}', '${ids.attendantUser}', 'ACTIVE');
    insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values ('${tenantId}', '${ids.attendant}', 'ATTENDANT', 'STATION', '${legalId}', '${stationId}');
    insert into app.products (id, tenant_id, code, name) values ('${ids.product}', '${tenantId}', 'DIESEL', 'Diesel 50');
    insert into app.pumps (id, tenant_id, station_id, number, status) values ('${ids.pump}', '${tenantId}', '${stationId}', '1', 'ACTIVE');
    insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
      values ('${ids.nozzle}', '${tenantId}', '${stationId}', '${ids.pump}', '1', '${ids.product}', 'ACTIVE');
    insert into app.meters (id, tenant_id, serial_number) values ('${ids.meter}', '${tenantId}', 'DEMO-METER-1');
    insert into app.meter_installations (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
      values ('${ids.installation}', '${tenantId}', '${stationId}', '${ids.nozzle}', '${ids.meter}', '2020-01-01T00:00:00Z', '${supervisorMembership}');
    insert into app.selling_prices (id, tenant_id, station_id, product_id, effective_from, unit_price, state, requested_by)
      values ('${ids.price}', '${tenantId}', '${stationId}', '${ids.product}', '2020-01-01T00:00:00Z', 1.500000, 'DRAFT', '${supervisorMembership}');
    insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
      values ('${ids.day}', '${tenantId}', '${stationId}', '${businessDate}', 'NOT_STARTED');
    update app.station_business_days set state='OPEN', opened_at=now() where id='${ids.day}';
    insert into app.shift_templates
      (id, tenant_id, station_id, code, name, start_time, duration_minutes, active, created_by)
      values ('${ids.shiftTemplate}', '${tenantId}', '${stationId}', 'DAY', 'Day shift', '06:00', 720, true, '${supervisorMembership}');
    update app.selling_prices set state='PENDING_APPROVAL' where id='${ids.price}';
    update app.selling_prices set state='APPROVED', approved_by='${actors.owner.membership_id}', approved_at=now() where id='${ids.price}';
    update app.selling_prices set state='PENDING_STATION_ACTIVATION' where id='${ids.price}';
    update app.selling_prices set state='BOUNDARIES_IN_PROGRESS' where id='${ids.price}';
    update app.selling_prices set state='ACTIVE', activated_at=now() where id='${ids.price}';
    insert into app.tanks (id, tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres, acceptable_variance_litres, status, created_by, updated_by)
      values ('${ids.tank}', '${tenantId}', '${stationId}', 'T1', '${ids.product}', 50000, 2000, 50, 'ACTIVE', '${supervisorMembership}', '${supervisorMembership}');
    insert into app.inventory_movements (id, tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
      values ('${ids.opening}', '${tenantId}', '${stationId}', '${ids.tank}', '${ids.product}', 'OPENING_BALANCE', 20000, '${businessDate}T05:00:00Z', '${businessDate}', 'CUTOVER', '${ids.opening}', '${supervisorMembership}');
    insert into app.tank_dips (id, tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by)
      values ('${ids.dip}', '${tenantId}', '${stationId}', '${ids.tank}', '${businessDate}T23:00:00Z', '${businessDate}', 18000, '${supervisorMembership}');
    insert into app.cash_locations (id, tenant_id, station_id, code, name, location_type) values
      ('${ids.till}', '${tenantId}', '${stationId}', 'TILL', 'Station till', 'STATION_TILL'),
      ('${ids.safe}', '${tenantId}', '${stationId}', 'SAFE', 'Station safe', 'STATION_SAFE');
    insert into app.bank_accounts (id, tenant_id, legal_entity_id, name, bank_name, account_reference_masked)
      values ('${ids.bank}', '${tenantId}', '${legalId}', 'Operating account', 'Demo Bank', '****4821');
  `);

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
          'idempotency-key': `demo-${key}`,
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

  await call(
    'inventory',
    {
      commandType: 'RecordOpeningInventoryCost',
      tenantId,
      stationId,
      tankId: ids.tank,
      amount: '20000.0000',
      currency: 'USD',
    },
    'opening-cost',
    'owner',
  );

  const nextReading = async () => {
    const rows = await client<{ reading_value: string }[]>`
      select reading_value from app.meter_boundaries
      where tenant_id=${tenantId} and nozzle_id=${ids.nozzle} and reading_status='AVAILABLE'
      order by effective_at desc, id desc limit 1`;
    return rows[0]?.reading_value ?? '100000.000';
  };
  const add = (a: string, b: number) => (Number(a) + b).toFixed(3);

  /** A fully populated day, ready for submission. Litres sold at 1.50 per litre. */
  async function populatedDay(
    tag: string,
    litres: number,
    payments: { method: string; amount: string }[],
    counted: string,
  ) {
    const reconciliationId = randomUUID();
    const shiftId = randomUUID();
    const common = { tenantId, stationId, reconciliationId };
    await call(
      'forecourt',
      {
        commandType: 'StartShift',
        tenantId,
        stationId,
        businessDayId: ids.day,
        shiftId,
        expectedVersion: 0,
        plannedStartAt: `${businessDate}T06:00:00.000Z`,
        shiftTemplateId: ids.shiftTemplate,
      },
      `${tag}-shift`,
      'supervisor',
    );
    const created = await call(
      'forecourt',
      {
        commandType: 'CreateProductionReconciliation',
        ...common,
        businessDayId: ids.day,
        shiftId,
        expectedVersion: 0,
      },
      `${tag}-create`,
      'supervisor',
    );
    const [revision] = await client<{ id: string }[]>`
      select id from app.reconciliation_revisions
      where tenant_id = ${tenantId} and station_id = ${stationId} and reconciliation_id = ${reconciliationId}
      order by revision desc, id desc limit 1`;
    if (!revision)
      throw new Error(`No reconciliation revision was created for ${reconciliationId}`);
    const revisionId = revision.id;
    await call(
      'forecourt',
      {
        commandType: 'SetAttendants',
        ...common,
        expectedVersion: 0,
        attendantIds: [ids.attendant],
      },
      `${tag}-attendants`,
      'supervisor',
    );
    const [shift] = await client<
      { version: number }[]
    >`select version from app.shifts where tenant_id=${tenantId} and id=${shiftId}`;
    const opening = await nextReading();
    const closing = add(opening, litres);
    const readings = [opening, closing];
    const boundaryIds: string[] = [];
    for (const [index, readingValue] of readings.entries()) {
      const boundaryId = randomUUID();
      boundaryIds.push(boundaryId);
      await call(
        'forecourt',
        {
          commandType: 'ConfirmBoundary',
          tenantId,
          stationId,
          boundaryId,
          nozzleId: ids.nozzle,
          meterInstallationId: ids.installation,
          businessDayId: ids.day,
          shiftId,
          responsibleAttendantId: ids.attendant,
          reason: index === 0 ? 'SHIFT_OPEN' : 'SHIFT_CLOSE',
          readingStatus: 'AVAILABLE',
          readingValue,
          ...(index === 0 ? { exceptionReason: 'Demo data' } : {}),
          expectedVersion: shift!.version,
        },
        `${tag}-boundary-${index}`,
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
        nozzleId: ids.nozzle,
        meterInstallationId: ids.installation,
        businessDayId: ids.day,
        shiftId,
        openingBoundaryId: open.id,
        closingBoundaryId: close.id,
        productId: ids.product,
        responsibleAttendantId: ids.attendant,
        startAt: open.effective_at.toISOString(),
        endAt: close.effective_at.toISOString(),
        expectedVersion: 0,
      },
      `${tag}-segment`,
      'supervisor',
    );
    await call(
      'forecourt',
      {
        commandType: 'SaveMeterReadings',
        ...common,
        expectedVersion: 1,
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
      },
      `${tag}-readings`,
      'supervisor',
    );
    await call(
      'forecourt',
      { commandType: 'SavePaymentAllocations', ...common, expectedVersion: 2, payments },
      `${tag}-payments`,
      'supervisor',
    );
    await call(
      'forecourt',
      { commandType: 'SaveExpenses', ...common, expectedVersion: 3, expenses: [] },
      `${tag}-expenses`,
      'supervisor',
    );
    await call(
      'forecourt',
      { commandType: 'SaveCashDeclaration', ...common, expectedVersion: 4, countedCash: counted },
      `${tag}-cash`,
      'supervisor',
    );
    await call(
      'forecourt',
      { commandType: 'SaveVarianceExplanations', ...common, expectedVersion: 5, explanations: {} },
      `${tag}-explanations`,
      'supervisor',
    );
    await call(
      'forecourt',
      { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: 6 },
      `${tag}-submit`,
      'supervisor',
    );
    return { common, reconciliationId, revisionId, shiftId };
  }

  const money = (litres: number) => (litres * 1.5).toFixed(2);

  // Two days left waiting for approval (submitted by the supervisor, so the owner or finance approves).
  await populatedDay('waiting-a', 500, [{ method: 'CASH', amount: money(500) }], money(500));
  await populatedDay('waiting-b', 300, [{ method: 'CASH', amount: money(300) }], money(300));

  // One day already approved: 600 L = cash 600 + card 300, so cash can be banked and card matched.
  const approved = await populatedDay(
    'approved',
    600,
    [
      { method: 'CASH', amount: '600.00' },
      { method: 'POS', amount: '300.00' },
    ],
    '600.00',
  );
  await call(
    'forecourt',
    { commandType: 'ApproveProductionReconciliation', ...approved.common, expectedVersion: 7 },
    'approved-approve',
    'owner',
  );

  // Cash: collect 600, bank 400 (awaiting bank confirmation), leave 200 collected but not banked.
  const stationContext = {
    organisationId: tenantId,
    legalEntityId: legalId,
    stationId,
    allStations: false,
  };
  const collect = async (ref: string, amount: string) =>
    (
      await call(
        'cash',
        {
          commandType: 'RecordCashCollection',
          context: stationContext,
          collectionReference: ref,
          sourceLocationId: ids.till,
          sources: [{ reconciliationId: approved.reconciliationId, amount }],
        },
        `collect-${ref}`,
        'finance',
      )
    ).collectionId as string;
  const first = await collect('COL-001', '400.00');
  await collect('COL-002', '200.00');
  await call(
    'cash',
    {
      commandType: 'ReceiveCashCollection',
      context: stationContext,
      collectionId: first,
      targetLocationId: ids.safe,
      expectedVersion: 0,
    },
    'receive-1',
    'finance',
  );
  await call(
    'cash',
    {
      commandType: 'CreateBankDeposit',
      context: stationContext,
      bankAccountId: ids.bank,
      sourceLocationId: ids.safe,
      depositReference: 'DEP-001',
      allocations: [{ collectionId: first, amount: '400.00' }],
    },
    'deposit-1',
    'finance',
  );

  // The owner sets up the provider (Finance cannot); Finance records the settlement.
  // Provider settlement for card payments: a $250 settlement declared against $300 of card sales, so $300 of payments remain unmatched until allocated.
  const provider = await call(
    'settlement',
    {
      commandType: 'CreatePaymentProvider',
      tenantId,
      stationId,
      code: 'ECOBANK-POS',
      name: 'Ecobank POS',
      providerType: 'CARD_ACQUIRER',
    },
    'provider',
    'owner',
  );
  const account = await call(
    'settlement',
    {
      commandType: 'ConfigureProviderAccount',
      tenantId,
      stationId,
      providerId: provider.providerId,
      accountReference: 'MERCHANT-001',
      displayName: 'Ecobank merchant account',
      currency: 'USD',
      accountStationId: stationId,
    },
    'account',
    'owner',
  );
  await call(
    'settlement',
    {
      commandType: 'RecordProviderSettlement',
      tenantId,
      stationId,
      providerAccountId: account.providerAccountId,
      settlementReference: 'SETTLE-001',
      batchReference: 'BATCH-001',
      transactionDate: businessDate,
      settlementDate: '2026-10-17',
      currency: 'USD',
      grossAmount: '250.0000',
      providerFeeAmount: '3.7500',
      providerDeductionAmount: '0.0000',
      reportedNetAmount: '246.2500',
      sourceType: 'MANUAL',
      sourceKey: 'demo-settlement-1',
    },
    'settlement',
    'finance',
  );

  // Supplier invoice, past its due date.
  const supplier = await call(
    'supplier',
    {
      tenantId,
      legalEntityId: legalId,
      commandType: 'CreateSupplier',
      code: 'PUMA-001',
      legalName: 'Puma Energy Zimbabwe',
    },
    'supplier',
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
      referenceNumber: 'INV-20458',
      documentDate: '2026-09-01',
      paymentTerms: 'CREDIT',
      creditPeriodDays: 29,
      amount: '12500.0000',
      lines: [{ description: 'Diesel 50 (bulk delivery)', quantity: '10000', unitPrice: '1.25' }],
    },
    'invoice',
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
    'invoice-post',
    'finance',
  );

  // Finance expense scenarios use the real command path so the demo exercises the same
  // approval, posting, recognition, payment, reversal, audit, and exact-decimal rules as the
  // application. The recurring templates are deliberately different so the owner can inspect
  // rent, subscription, insurance, and salary obligations independently.
  const expenseCategory = async (
    code: string,
    name: string,
    classification: 'OPERATING' | 'FIXED_COST',
  ) =>
    (
      await call(
        'expense',
        {
          commandType: 'CreateExpenseCategory',
          tenantId,
          legalEntityId: legalId,
          code,
          name,
          classification,
        },
        `expense-category-${code}`,
        'finance',
      )
    ).categoryId as string;

  const operatingCategory = await expenseCategory('DEMO-UTILITIES', 'Utilities', 'OPERATING');
  const rentCategory = await expenseCategory('DEMO-RENT', 'Rent', 'FIXED_COST');
  const subscriptionCategory = await expenseCategory(
    'DEMO-SUBSCRIPTION',
    'Subscriptions',
    'FIXED_COST',
  );
  const insuranceCategory = await expenseCategory('DEMO-INSURANCE', 'Insurance', 'FIXED_COST');
  const salaryCategory = await expenseCategory('DEMO-SALARY', 'Salaries', 'FIXED_COST');

  const expenseCommand = (input: Record<string, unknown>, key: string, who: Who = 'finance') =>
    call('expense', { tenantId, stationId, ...input }, `expense-${key}`, who);

  // Pending approval: the supervisor can submit, while Finance/Owner can approve.
  await expenseCommand(
    {
      commandType: 'SubmitExpense',
      categoryId: operatingCategory,
      expenseDate: businessDate,
      description: 'Station utilities awaiting approval',
      payee: 'Demo Utilities',
      reference: 'DEMO-UTILITY-PENDING',
      amount: '125.2500',
    },
    'pending-utility',
    'supervisor',
  );

  // Approved and posted, but unpaid: this remains visible as an outstanding payable.
  const posted = await expenseCommand(
    {
      commandType: 'SubmitExpense',
      categoryId: operatingCategory,
      expenseDate: businessDate,
      description: 'Station maintenance approved and posted',
      payee: 'Demo Maintenance',
      reference: 'DEMO-MAINTENANCE-POSTED',
      amount: '275.0000',
    },
    'posted-maintenance-submit',
    'supervisor',
  );
  const approvedPosted = await expenseCommand(
    { commandType: 'ApproveExpense', expenseId: posted.expenseId, expectedVersion: 0 },
    'posted-maintenance-approve',
  );
  await expenseCommand(
    {
      commandType: 'PostExpense',
      expenseId: posted.expenseId,
      expectedVersion: approvedPosted.version,
    },
    'posted-maintenance-post',
  );

  // Approved, posted, and paid by bank reference.
  const paid = await expenseCommand(
    {
      commandType: 'SubmitExpense',
      categoryId: operatingCategory,
      expenseDate: businessDate,
      description: 'Station cleaning paid by bank',
      payee: 'Demo Cleaning',
      reference: 'DEMO-CLEANING-PAID',
      amount: '80.1250',
    },
    'paid-cleaning-submit',
    'supervisor',
  );
  const paidApproved = await expenseCommand(
    { commandType: 'ApproveExpense', expenseId: paid.expenseId, expectedVersion: 0 },
    'paid-cleaning-approve',
  );
  const paidPosted = await expenseCommand(
    {
      commandType: 'PostExpense',
      expenseId: paid.expenseId,
      expectedVersion: paidApproved.version,
    },
    'paid-cleaning-post',
  );
  await expenseCommand(
    {
      commandType: 'RecordExpensePayment',
      expenseId: paid.expenseId,
      expectedVersion: paidPosted.version,
      paymentDate: businessDate,
      amount: '80.1250',
      settlementSource: 'BANK',
      externalReference: 'DEMO-BANK-CLEANING',
    },
    'paid-cleaning-payment',
  );

  const recurringTemplate = async (
    key: string,
    categoryId: string,
    name: string,
    amount: string,
    startDate: string,
  ) =>
    expenseCommand(
      {
        commandType: 'CreateRecurringCostTemplate',
        categoryId,
        name,
        amount,
        startDate,
      },
      `${key}-template`,
    );

  const recurringPeriod = async (key: string, templateId: string, periodStart: string) =>
    expenseCommand(
      { commandType: 'GenerateRecurringCostPeriod', templateId, periodStart },
      `${key}-period`,
    );

  const recognize = (key: string, periodId: string, recognitionDate: string) =>
    expenseCommand(
      { commandType: 'RecognizeRecurringCost', periodId, recognitionDate },
      `${key}-recognition-${recognitionDate}`,
    );

  // Rent is recognized and paid for September.
  const rent = await recurringTemplate(
    'rent',
    rentCategory,
    'Monthly station rent',
    '1000.0000',
    '2026-09-01',
  );
  const rentPeriod = await recurringPeriod('rent', rent.templateId, '2026-09-01');
  await recognize('rent', rentPeriod.periodId, '2026-09-01');
  await recognize('rent', rentPeriod.periodId, '2026-09-30');
  await expenseCommand(
    {
      commandType: 'RecordExpensePayment',
      recurringPeriodId: rentPeriod.periodId,
      expectedVersion: 0,
      paymentDate: '2026-09-02',
      amount: '1000.0000',
      settlementSource: 'BANK',
      externalReference: 'DEMO-RENT-SEP',
    },
    'rent-payment',
  );

  // Subscription is recognized but unpaid, demonstrating an outstanding recurring payable.
  const subscription = await recurringTemplate(
    'subscription',
    subscriptionCategory,
    'Monthly software subscription',
    '99.9900',
    '2026-10-01',
  );
  const subscriptionPeriod = await recurringPeriod(
    'subscription',
    subscription.templateId,
    '2026-10-01',
  );
  await recognize('subscription', subscriptionPeriod.periodId, '2026-10-01');

  // Insurance uses a four-decimal amount so the daily split and final remainder are visible in
  // demo data without passing through JavaScript floating point arithmetic.
  const insurance = await recurringTemplate(
    'insurance',
    insuranceCategory,
    'Monthly insurance allocation',
    '1234.5678',
    '2026-10-01',
  );
  const insurancePeriod = await recurringPeriod('insurance', insurance.templateId, '2026-10-01');
  await recognize('insurance', insurancePeriod.periodId, '2026-10-01');
  await recognize('insurance', insurancePeriod.periodId, '2026-10-24');

  // Salary is recognized and paid, while one recognition is reversed with the original kept.
  const salary = await recurringTemplate(
    'salary',
    salaryCategory,
    'Monthly station salaries',
    '3000.0000',
    '2026-10-01',
  );
  const salaryPeriod = await recurringPeriod('salary', salary.templateId, '2026-10-01');
  await recognize('salary', salaryPeriod.periodId, '2026-10-01');
  await recognize('salary', salaryPeriod.periodId, '2026-10-02');
  await expenseCommand(
    {
      commandType: 'ReverseRecurringCostRecognition',
      periodId: salaryPeriod.periodId,
      recognitionDate: '2026-10-01',
      reason: 'Demo correction: payroll date moved',
    },
    'salary-reversal',
  );
  await expenseCommand(
    {
      commandType: 'RecordExpensePayment',
      recurringPeriodId: salaryPeriod.periodId,
      expectedVersion: 0,
      paymentDate: '2026-10-02',
      amount: '3000.0000',
      settlementSource: 'BANK',
      externalReference: 'DEMO-SALARY-OCT',
    },
    'salary-payment',
  );

  // Finish the seeded day through the same workflow commands a real station uses. This leaves
  // yesterday approved and closed, while the next business day remains available to open.
  await call(
    'forecourt',
    {
      commandType: 'CloseMeters',
      tenantId,
      stationId,
      businessDayId: ids.day,
      shiftId: approved.shiftId,
      expectedVersion: 1,
    },
    'approved-close-meters',
    'supervisor',
  );
  await call(
    'forecourt',
    {
      commandType: 'CompleteShift',
      tenantId,
      stationId,
      businessDayId: ids.day,
      shiftId: approved.shiftId,
      expectedVersion: 2,
    },
    'approved-complete-shift',
    'supervisor',
  );
  await call(
    'forecourt',
    {
      commandType: 'PostReconciliation',
      tenantId,
      stationId,
      revisionId: approved.revisionId,
      expectedVersion: 8,
    },
    'approved-post',
    'owner',
  );
  await call(
    'forecourt',
    {
      commandType: 'LockReconciliation',
      tenantId,
      stationId,
      revisionId: approved.revisionId,
      expectedVersion: 9,
    },
    'approved-lock-reconciliation',
    'owner',
  );
  await call(
    'forecourt',
    {
      commandType: 'CloseBusinessDay',
      tenantId,
      stationId,
      businessDayId: ids.day,
      expectedVersion: 0,
    },
    'approved-close-day',
    'owner',
  );
  await call(
    'forecourt',
    {
      commandType: 'LockBusinessDay',
      tenantId,
      stationId,
      businessDayId: ids.day,
      expectedVersion: 2,
    },
    'approved-lock-day',
    'owner',
  );

  await client`
    insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
    values ('${randomUUID()}', '${tenantId}', '${stationId}', '2026-10-27', 'NOT_STARTED')
  `;
}
