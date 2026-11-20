import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readDeliveryVariance } from '../../src/modules/reporting/table-reports/read';
import { clerkHeaders } from './auth-session-fixtures';
import { queryDeliveryList } from '../../src/modules/deliveries/queries';
import { createQa1ScenarioContext, QA1_TIMES, type Qa1ScenarioContext } from './qa1/fixture';
import {
  confirmDelivery,
  deliveryDetail,
  inventory,
  postOpeningPosition,
  supplier,
} from './qa1/commands';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for delivery variance tests.');
let client: Sql;

const hoursAfterOpening = (hours: number) =>
  new Date(Date.parse(QA1_TIMES.opening) + hours * 3_600_000).toISOString();

async function newSupplier(ctx: Qa1ScenarioContext, key: string): Promise<string> {
  const created = await supplier(
    ctx,
    {
      commandType: 'CreateSupplier',
      tenantId: ctx.tenantId,
      legalEntityId: ctx.legalEntityId,
      code: `VAR-${key}-${ctx.runId.slice(0, 6)}`,
      legalName: `Variance ${key}`,
    },
    `var-supplier-${key}`,
  );
  return created.body.supplierId as string;
}

function record(
  ctx: Qa1ScenarioContext,
  key: string,
  supplierId: string,
  note: string,
  received: string,
  extra: Record<string, unknown> = {},
) {
  return inventory(
    ctx,
    {
      commandType: 'CreateDelivery',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      productId: ctx.productId,
      supplierId,
      noPoReason: 'EMERGENCY_PURCHASE',
      deliveryNoteNumber: `VAR-DN-${key}`,
      deliveredAt: hoursAfterOpening(3),
      noteQuantityLitres: note,
      actualQuantityLitres: received,
      allocations: [{ tankId: ctx.tankId, quantityLitres: received }],
      ...extra,
    },
    `${key}-create`,
  );
}

describe('delivery loss: explain it and follow it up (PostgreSQL)', { timeout: 120_000 }, () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-delivery-variance-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-delivery-variance-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => client?.end());

  it('refuses a shortage above the allowance until a cause is given, then keeps the cause', async () => {
    const ctx = await createQa1ScenarioContext(client, 'var-short');
    await postOpeningPosition(client, ctx, 'var-short-opening', '1000.000', '1000.0000');
    const supplierId = await newSupplier(ctx, 'short');

    const bare = await record(ctx, 'var-short-a', supplierId, '10000', '9888');
    expect(bare.response.status, JSON.stringify(bare.body)).toBe(400);
    expect(JSON.stringify(bare.body)).toContain('Say why');

    const other = await record(ctx, 'var-short-b', supplierId, '10000', '9888', {
      varianceCause: 'OTHER',
    });
    expect(other.response.status).toBe(400);
    expect(JSON.stringify(other.body)).toContain('few words');

    const ok = await record(ctx, 'var-short-c', supplierId, '10000', '9888', {
      varianceCause: 'THEFT_SUSPECTED',
      varianceNote: 'Seal was loose',
      loadTemperatureC: '31.5',
    });
    expect(ok.response.status, JSON.stringify(ok.body)).toBe(200);
    const rows = await client`
      select variance_cause, variance_note, load_temperature_c::text as temp,
        actual_quantity_litres::text as received
      from app.fuel_deliveries where id = ${ok.body.deliveryId as string}`;
    expect(rows[0]).toMatchObject({
      variance_cause: 'THEFT_SUSPECTED',
      variance_note: 'Seal was loose',
      temp: '31.5',
      received: '9888.000',
    });
  });

  it('needs no cause inside the allowance, and drops a cause that was not needed', async () => {
    const ctx = await createQa1ScenarioContext(client, 'var-ok');
    await postOpeningPosition(client, ctx, 'var-ok-opening', '1000.000', '1000.0000');
    const supplierId = await newSupplier(ctx, 'ok');
    const inside = await record(ctx, 'var-ok-a', supplierId, '1000', '998', {
      varianceCause: 'TEMPERATURE',
    });
    expect(inside.response.status, JSON.stringify(inside.body)).toBe(200);
    const rows = await client`
      select variance_cause from app.fuel_deliveries where id = ${inside.body.deliveryId as string}`;
    expect(rows[0]!.variance_cause).toBeNull();
  });

  it('flags a dip that disagrees with what was received, even when the note matches', async () => {
    const ctx = await createQa1ScenarioContext(client, 'var-dip');
    await postOpeningPosition(client, ctx, 'var-dip-opening', '1000.000', '1000.0000');
    const supplierId = await newSupplier(ctx, 'dip');
    const dips = {
      preDeliveryDip: { measuredAt: hoursAfterOpening(2), physicalLitres: '1000' },
      postDeliveryDip: { measuredAt: hoursAfterOpening(3), physicalLitres: '1600' },
    };
    const refused = await record(ctx, 'var-dip-a', supplierId, '1000', '1000', dips);
    expect(refused.response.status, JSON.stringify(refused.body)).toBe(400);
    const accepted = await record(ctx, 'var-dip-b', supplierId, '1000', '1000', {
      ...dips,
      varianceCause: 'MEASURING_ERROR',
    });
    expect(accepted.response.status, JSON.stringify(accepted.body)).toBe(200);
  });

  it('records a claim after confirmation, validates it, and refuses one where nothing was lost', async () => {
    const ctx = await createQa1ScenarioContext(client, 'var-claim');
    await postOpeningPosition(client, ctx, 'var-claim-opening', '1000.000', '1000.0000');
    const supplierId = await newSupplier(ctx, 'claim');
    const lost = await record(ctx, 'var-claim-a', supplierId, '1000', '900', {
      varianceCause: 'THEFT_SUSPECTED',
    });
    const deliveryId = lost.body.deliveryId as string;
    await confirmDelivery(ctx, deliveryId, 'var-claim-confirm');

    const claim = (
      key: string,
      body: Record<string, unknown>,
      id = deliveryId,
      who: 'admin' | 'supervisor' | 'finance' | 'attendant' = 'supervisor',
    ) =>
      deliveryDetail(
        ctx,
        {
          commandType: 'RecordDeliveryLossClaim',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          deliveryId: id,
          ...body,
        },
        key,
        who,
      );
    const review = (
      key: string,
      body: Record<string, unknown>,
      who: 'admin' | 'supervisor' | 'finance' | 'attendant' = 'admin',
    ) =>
      deliveryDetail(
        ctx,
        {
          commandType: 'ReviewDeliveryLossClaim',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          deliveryId,
          ...body,
        },
        key,
        who,
      );

    // Validation: a party, an expected amount to raise, an amount and a method to settle.
    expect(
      (await claim('var-claim-1', { liableParty: 'NONE', status: 'RAISED' })).response.status,
    ).toBe(400);
    expect(
      (await claim('var-claim-2', { liableParty: 'DRIVER', status: 'RAISED', currency: 'USD' }))
        .response.status,
    ).toBe(400);
    expect(
      (await claim('var-claim-2b', { liableParty: 'DRIVER', status: 'SETTLED', currency: 'USD' }))
        .response.status,
    ).toBe(400);

    // Who may record: a supervisor and finance can, an attendant cannot.
    const attendant = await claim(
      'var-claim-att',
      { liableParty: 'DRIVER', status: 'RAISED', expectedAmount: '120', currency: 'USD' },
      deliveryId,
      'attendant',
    );
    expect(attendant.response.status).toBe(403);

    const raised = await claim('var-claim-3', {
      liableParty: 'DRIVER',
      status: 'RAISED',
      expectedAmount: '120.50',
      currency: 'USD',
    });
    expect(raised.response.status, JSON.stringify(raised.body)).toBe(200);
    expect(raised.body.approvalStatus).toBe('PENDING');

    // Who may approve: not the person who recorded it, not a supervisor or finance.
    expect(
      (await review('var-rev-sup', { decision: 'APPROVED' }, 'supervisor')).response.status,
    ).toBe(403);
    expect((await review('var-rev-fin', { decision: 'APPROVED' }, 'finance')).response.status).toBe(
      403,
    );
    expect(
      (await review('var-rev-att', { decision: 'APPROVED' }, 'attendant')).response.status,
    ).toBe(403);
    // Sending back needs words.
    expect((await review('var-rev-nonote', { decision: 'REJECTED' })).response.status).toBe(400);
    const sentBack = await review('var-rev-back', { decision: 'REJECTED', note: 'Wrong amount' });
    expect(sentBack.response.status, JSON.stringify(sentBack.body)).toBe(200);
    // Already decided: nothing waiting.
    expect((await review('var-rev-again', { decision: 'APPROVED' })).response.status).toBe(409);

    // Recording again puts it back to waiting, and approval then works.
    const again = await claim('var-claim-3b', {
      liableParty: 'DRIVER',
      status: 'RAISED',
      expectedAmount: '130',
      currency: 'USD',
    });
    expect(again.body.approvalStatus).toBe('PENDING');
    const approved = await review('var-rev-ok', { decision: 'APPROVED' });
    expect(approved.response.status, JSON.stringify(approved.body)).toBe(200);

    // An administrator who recorded the change cannot approve it themselves.
    await claim(
      'var-claim-admin',
      {
        liableParty: 'DRIVER',
        status: 'RAISED',
        expectedAmount: '130',
        currency: 'USD',
      },
      deliveryId,
      'admin',
    );
    expect((await review('var-rev-self', { decision: 'APPROVED' })).response.status).toBe(403);
    const byFinanceRecord = await claim(
      'var-claim-fin',
      {
        liableParty: 'DRIVER',
        status: 'RAISED',
        expectedAmount: '130',
        currency: 'USD',
      },
      deliveryId,
      'finance',
    );
    expect(byFinanceRecord.response.status, JSON.stringify(byFinanceRecord.body)).toBe(200);
    expect((await review('var-rev-ok2', { decision: 'APPROVED' })).response.status).toBe(200);

    // Settle: the amount, the method and the currency are kept; the expected amount is carried.
    const settled = await claim('var-claim-4', {
      liableParty: 'DRIVER',
      status: 'SETTLED',
      recoveredAmount: '120.50',
      settlementMethod: 'SUPPLIER_BALANCE',
      currency: 'USD',
    });
    expect(settled.response.status, JSON.stringify(settled.body)).toBe(200);
    const settleReview = await review('var-rev-settle', { decision: 'APPROVED' });
    expect(settleReview.response.status, JSON.stringify(settleReview.body)).toBe(200);
    expect(settleReview.body.posted).toBe('SUPPLIER_ACCOUNT');
    // Taken off what is owed to the supplier: one credit on their account, never a second.
    const credits = await client`
      select amount::text as amount, movement_type, supplier_id, source_type
      from app.supplier_account_movements
      where source_type = 'DELIVERY_LOSS_CLAIM'
        and source_id in (select id from app.fuel_delivery_loss_claims where delivery_id = ${deliveryId})`;
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({
      amount: '120.5000',
      movement_type: 'CREDIT_NOTE',
      supplier_id: supplierId,
    });
    const rows = await client`
      select liable_party, status, expected_amount::text as expected,
        recovered_amount::text as amount, settlement_method, currency, approval_status
      from app.fuel_delivery_loss_claims where delivery_id = ${deliveryId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      liable_party: 'DRIVER',
      status: 'SETTLED',
      expected: '130.0000',
      amount: '120.5000',
      settlement_method: 'SUPPLIER_BALANCE',
      currency: 'USD',
      approval_status: 'APPROVED',
    });

    // The report shows the reason, the claim and the amounts with their currency.
    const reportRows = await readDeliveryVariance(
      drizzle(client) as never,
      {
        tenantId: ctx.tenantId,
        stationIds: [ctx.stationId],
        fromDate: '2000-01-01',
        toDate: '2100-01-01',
      } as never,
      {} as never,
    );
    const reported = reportRows.find((row) => row.claim === 'Paid back');
    expect(reported).toMatchObject({
      responsible: 'The driver',
      approval: 'Approved',
      expectedBack: 'USD 130.0000',
      paidBack: 'USD 120.5000',
      paidBackBy: 'Taken off the supplier balance',
    });

    // An approved settlement is closed.
    const closed = await claim('var-claim-closed', {
      liableParty: 'DRIVER',
      status: 'WRITTEN_OFF',
    });
    expect(closed.response.status).toBe(409);

    const exact = await record(ctx, 'var-claim-b', supplierId, '100', '100');
    const nothing = await claim(
      'var-claim-5',
      { liableParty: 'DRIVER', status: 'RAISED', expectedAmount: '10', currency: 'USD' },
      exact.body.deliveryId as string,
    );
    expect(nothing.response.status).toBe(409);
  });

  it('reports who keeps arriving short, and counts only confirmed deliveries', async () => {
    const ctx = await createQa1ScenarioContext(client, 'var-report');
    await postOpeningPosition(client, ctx, 'var-report-opening', '1000.000', '1000.0000');
    const supplierId = await newSupplier(ctx, 'report');
    const who = { driver: 'Tendai Moyo', truckRegistration: 'ABC 1234' };
    for (const [key, received] of [
      ['a', '900'],
      ['b', '950'],
    ] as const) {
      const made = await record(ctx, `var-report-${key}`, supplierId, '1000', received, {
        ...who,
        varianceCause: 'THEFT_SUSPECTED',
      });
      expect(made.response.status, JSON.stringify(made.body)).toBe(200);
      await confirmDelivery(ctx, made.body.deliveryId as string, `var-report-confirm-${key}`);
    }
    const draft = await record(ctx, 'var-report-c', supplierId, '1000', '500', {
      ...who,
      varianceCause: 'SPILL_OR_LEAK',
    });
    expect(draft.response.status).toBe(200);

    const list = await queryDeliveryList({
      request: new Request('http://127.0.0.1:3000/deliveries', {
        headers: clerkHeaders(ctx.actors.admin.token),
      }),
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
    });
    const driver = list.lossReport.find((row) => row.kind === 'DRIVER');
    expect(driver).toMatchObject({ name: 'Tendai Moyo', shortDeliveries: 2, deliveries: 2 });
    expect(Number(driver!.shortLitres)).toBe(150);
    const truck = list.lossReport.find((row) => row.kind === 'TRUCK');
    expect(truck?.name).toBe('ABC 1234');
    expect(list.lossReport.some((row) => row.kind === 'SUPPLIER')).toBe(true);
  });
});
