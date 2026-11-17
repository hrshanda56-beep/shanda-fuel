import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { createQa1ScenarioContext, QA1_TIMES, type Qa1ScenarioContext } from './qa1/fixture';
import {
  confirmDelivery,
  createDelivery,
  inventory,
  postOpeningPosition,
  supplier,
} from './qa1/commands';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for delivery edit tests.');
let client: Sql;

const hoursAfterOpening = (hours: number) =>
  new Date(Date.parse(QA1_TIMES.opening) + hours * 3_600_000).toISOString();

async function createSupplier(ctx: Qa1ScenarioContext, key: string, name: string): Promise<string> {
  const created = await supplier(
    ctx,
    {
      commandType: 'CreateSupplier',
      tenantId: ctx.tenantId,
      legalEntityId: ctx.legalEntityId,
      code: `ED-${key}-${ctx.runId.slice(0, 6)}`,
      legalName: name,
    },
    `edit-supplier-${key}`,
  );
  return created.body.supplierId as string;
}

function update(ctx: Qa1ScenarioContext, key: string, deliveryId: string, extra: object = {}) {
  return inventory(
    ctx,
    {
      commandType: 'UpdateDelivery',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      deliveryId,
      tankId: ctx.tankId,
      noteQuantityLitres: '500',
      actualQuantityLitres: '500',
      deliveredAt: hoursAfterOpening(3),
      noPoReason: 'EMERGENCY_PURCHASE',
      ...extra,
    },
    key,
  );
}

describe('editing a draft delivery (PostgreSQL)', { timeout: 120_000 }, () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-delivery-edit-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-delivery-edit-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => client?.end());

  it('changes the details and keeps the one allocation in step with the litres received', async () => {
    const ctx = await createQa1ScenarioContext(client, 'edit-draft');
    await postOpeningPosition(client, ctx, 'edit-draft-opening', '1000.000', '1000.0000');
    const supplierA = await createSupplier(ctx, 'a', 'Supplier A');
    const supplierB = await createSupplier(ctx, 'b', 'Supplier B');
    const delivery = await createDelivery(ctx, 'edit-draft', {
      quantityLitres: '500.000',
      deliveredAt: hoursAfterOpening(3),
      supplierId: supplierA,
    });

    const changed = await update(ctx, 'edit-draft-update', delivery.deliveryId, {
      supplierId: supplierB,
      deliveryNoteNumber: 'EDITED-NOTE-1',
      noteQuantityLitres: '520',
      actualQuantityLitres: '510.5',
      transporter: 'Moyo Haulage',
      truckRegistration: 'ABC 1234',
    });
    expect(changed.response.status, JSON.stringify(changed.body)).toBe(200);

    const [row] = await client<
      {
        supplier_id: string;
        delivery_note_number: string;
        note: string;
        actual: string;
        shortage: string;
        transporter: string;
        allocated: string;
      }[]
    >`
      select d.supplier_id, d.delivery_note_number,
        d.note_quantity_litres::text as note, d.actual_quantity_litres::text as actual,
        d.shortage_excess_litres::text as shortage, d.transporter,
        (select sum(quantity_litres)::text from app.fuel_delivery_allocations a
          where a.delivery_id = d.id) as allocated
      from app.fuel_deliveries d where d.id = ${delivery.deliveryId}
    `;
    expect(row!.supplier_id).toBe(supplierB);
    expect(row!.delivery_note_number).toBe('EDITED-NOTE-1');
    expect(Number(row!.note)).toBe(520);
    expect(Number(row!.actual)).toBe(510.5);
    expect(Number(row!.shortage)).toBe(-9.5);
    expect(row!.transporter).toBe('Moyo Haulage');
    // The allocation moved with the litres, so the delivery can still be confirmed.
    expect(Number(row!.allocated)).toBe(510.5);
    await confirmDelivery(ctx, delivery.deliveryId, 'edit-draft-confirm');
  });

  it('refuses a note number another delivery already uses, naming it', async () => {
    const ctx = await createQa1ScenarioContext(client, 'edit-dup');
    await postOpeningPosition(client, ctx, 'edit-dup-opening', '1000.000', '1000.0000');
    const supplierId = await createSupplier(ctx, 'dup', 'Supplier D');
    const first = await createDelivery(ctx, 'edit-dup-1', {
      quantityLitres: '100.000',
      deliveredAt: hoursAfterOpening(2),
      supplierId,
    });
    const second = await createDelivery(ctx, 'edit-dup-2', {
      quantityLitres: '100.000',
      deliveredAt: hoursAfterOpening(3),
      supplierId,
    });
    const clash = await update(ctx, 'edit-dup-update', second.deliveryId, {
      supplierId,
      deliveryNoteNumber: 'QA1-DN-edit-dup-1',
      noteQuantityLitres: '100',
      actualQuantityLitres: '100',
    });
    expect(first.deliveryId).not.toBe(second.deliveryId);
    expect(clash.response.status, JSON.stringify(clash.body)).toBe(409);
    expect(JSON.stringify(clash.body)).toContain('QA1-DN-edit-dup-1');
  });

  it('refuses to change a delivery once it is confirmed', async () => {
    const ctx = await createQa1ScenarioContext(client, 'edit-locked');
    await postOpeningPosition(client, ctx, 'edit-locked-opening', '1000.000', '1000.0000');
    const supplierId = await createSupplier(ctx, 'lock', 'Supplier L');
    const delivery = await createDelivery(ctx, 'edit-locked', {
      quantityLitres: '500.000',
      deliveredAt: hoursAfterOpening(3),
      supplierId,
    });
    await confirmDelivery(ctx, delivery.deliveryId, 'edit-locked-confirm');
    const attempt = await update(ctx, 'edit-locked-update', delivery.deliveryId, {
      supplierId,
      deliveryNoteNumber: 'SNEAKY-EDIT',
      noteQuantityLitres: '500',
      actualQuantityLitres: '400',
    });
    expect(attempt.response.status, JSON.stringify(attempt.body)).toBe(409);
    expect(JSON.stringify(attempt.body)).toContain('already confirmed or cancelled');
  });
});
