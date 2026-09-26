import { makeSignature } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { POST as cashCommandPost } from '../../../src/app/api/cash/commands/route';
import { POST as customerCommandPost } from '../../../src/app/api/customers/commands/route';
import { POST as forecourtCommandPost } from '../../../src/app/api/forecourt/commands/route';
import { POST as inventoryCommandPost } from '../../../src/app/api/inventory/commands/route';
import { POST as settlementCommandPost } from '../../../src/app/api/settlements/commands/route';
import { POST as supplierCommandPost } from '../../../src/app/api/suppliers/commands/route';
import { ExactDecimal } from '../../../src/platform/domain/primitives';
import { QA1_TIMES, type Qa1ActorName, type Qa1ScenarioContext } from './fixture';

export type JsonRecord = Record<string, any>;

export type Qa1CommandResult = {
  response: Response;
  body: JsonRecord;
};

type RoutePost = (request: Request) => Promise<Response>;

async function signedCookie(token: string): Promise<string> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required for QA1 integration tests');
  return `${token}.${await makeSignature(token, secret)}`;
}

async function post(
  route: RoutePost,
  body: JsonRecord,
  key: string,
  token: string,
): Promise<Qa1CommandResult> {
  const response = await route(
    new Request('http://127.0.0.1:3000/api/qa1-command', {
      method: 'POST',
      headers: {
        cookie: `shanda-fuel.session_token=${await signedCookie(token)}`,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    }),
  );
  return { response, body: (await response.json()) as JsonRecord };
}

export function actor(ctx: Qa1ScenarioContext, name: Qa1ActorName): string {
  return ctx.actors[name].token;
}

export async function forecourt(
  ctx: Qa1ScenarioContext,
  body: JsonRecord,
  key: string,
  name: Qa1ActorName = 'admin',
): Promise<Qa1CommandResult> {
  return post(forecourtCommandPost, body, key, actor(ctx, name));
}

export async function inventory(
  ctx: Qa1ScenarioContext,
  body: JsonRecord,
  key: string,
  name: Qa1ActorName = 'admin',
): Promise<Qa1CommandResult> {
  return post(inventoryCommandPost, body, key, actor(ctx, name));
}

export async function cash(
  ctx: Qa1ScenarioContext,
  body: JsonRecord,
  key: string,
  name: Qa1ActorName = 'admin',
): Promise<Qa1CommandResult> {
  return post(cashCommandPost, body, key, actor(ctx, name));
}

export async function supplier(
  ctx: Qa1ScenarioContext,
  body: JsonRecord,
  key: string,
  name: Qa1ActorName = 'finance',
): Promise<Qa1CommandResult> {
  return post(supplierCommandPost, body, key, actor(ctx, name));
}

export async function customer(
  ctx: Qa1ScenarioContext,
  body: JsonRecord,
  key: string,
  name: Qa1ActorName = 'admin',
): Promise<Qa1CommandResult> {
  return post(customerCommandPost, body, key, actor(ctx, name));
}

export async function settlement(
  ctx: Qa1ScenarioContext,
  body: JsonRecord,
  key: string,
  name: Qa1ActorName = 'finance',
): Promise<Qa1CommandResult> {
  return post(settlementCommandPost, body, key, actor(ctx, name));
}

export function assertDecimal(actual: unknown, expected: string, label = 'decimal'): void {
  if (typeof actual !== 'string') throw new Error(`${label} was not serialized as a string`);
  if (!new ExactDecimal(actual).equals(new ExactDecimal(expected))) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

export async function postOpeningPosition(
  client: Sql,
  ctx: Qa1ScenarioContext,
  keyPrefix: string,
  quantity = '1000.000',
  amount = '1000.0000',
): Promise<void> {
  const openingSourceId = randomUUID();
  const opening = await inventory(
    ctx,
    {
      commandType: 'RecordOpeningBalance',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      tankId: ctx.tankId,
      quantityLitres: quantity,
      effectiveAt: QA1_TIMES.opening,
    },
    `${keyPrefix}-opening-${openingSourceId}`,
  );
  if (opening.response.status !== 200) throw new Error(JSON.stringify(opening.body));

  const source = await client.unsafe<{ source_id: string }[]>(`
    select source_id from app.inventory_movements
    where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      and tank_id='${ctx.tankId}' and movement_type='OPENING_BALANCE'
    order by effective_at desc, id desc limit 1
  `);
  const sourceId = source[0]?.source_id ?? openingSourceId;
  const cost = await inventory(
    ctx,
    {
      commandType: 'RecordOpeningInventoryCost',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      tankId: ctx.tankId,
      amount,
      currency: 'USD',
    },
    `${keyPrefix}-opening-cost-${sourceId}`,
  );
  if (cost.response.status !== 200) throw new Error(JSON.stringify(cost.body));
}

export async function openBusinessDayAndShift(
  ctx: Qa1ScenarioContext,
  keyPrefix: string,
  businessDayId = ctx.businessDayId,
  plannedStartAt: string = QA1_TIMES.opening,
  plannedEndAt: string = '2026-09-27T05:00:00.000Z',
): Promise<{ shiftId: string }> {
  const opened = await forecourt(
    ctx,
    {
      commandType: 'OpenBusinessDay',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      businessDayId,
      expectedVersion: 0,
    },
    `${keyPrefix}-open-day`,
  );
  if (opened.response.status !== 200) throw new Error(JSON.stringify(opened.body));

  return startShift(ctx, keyPrefix, businessDayId, plannedStartAt, plannedEndAt);
}

export async function startShift(
  ctx: Qa1ScenarioContext,
  keyPrefix: string,
  businessDayId = ctx.businessDayId,
  plannedStartAt: string = QA1_TIMES.opening,
  plannedEndAt: string = '2026-09-27T05:00:00.000Z',
): Promise<{ shiftId: string }> {
  const shiftId = randomUUID();
  const started = await forecourt(
    ctx,
    {
      commandType: 'StartShift',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      businessDayId,
      shiftId,
      expectedVersion: 0,
      plannedStartAt,
      plannedEndAt,
    },
    `${keyPrefix}-start-shift`,
    'supervisor',
  );
  if (started.response.status !== 200) throw new Error(JSON.stringify(started.body));
  return { shiftId };
}

async function currentShiftVersion(client: Sql, ctx: Qa1ScenarioContext, shiftId: string) {
  const rows = await client.unsafe<{ version: number; state: string }[]>(`
    select version, state from app.shifts
    where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' and id='${shiftId}'
  `);
  if (!rows[0]) throw new Error(`QA1 shift ${shiftId} was not found`);
  return rows[0];
}

export async function sealMeterSegments(
  client: Sql,
  ctx: Qa1ScenarioContext,
  shiftId: string,
  readings: readonly string[],
  keyPrefix: string,
  boundaryTimes: readonly string[] = readings.length === 3
    ? [QA1_TIMES.segmentOpen, QA1_TIMES.deliveryBoundary, QA1_TIMES.segmentClose]
    : [QA1_TIMES.segmentOpen, QA1_TIMES.segmentClose],
  businessDayId = ctx.businessDayId,
): Promise<{ segmentIds: string[] }> {
  if (boundaryTimes.length !== readings.length) {
    throw new Error('QA1 boundary time count must match meter reading count');
  }
  const shift = await currentShiftVersion(client, ctx, shiftId);
  const boundaryIds: string[] = [];
  for (const [index, readingValue] of readings.entries()) {
    const boundaryId = randomUUID();
    boundaryIds.push(boundaryId);
    const boundary = await forecourt(
      ctx,
      {
        commandType: 'ConfirmBoundary',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        boundaryId,
        nozzleId: ctx.nozzleId,
        meterInstallationId: ctx.meterInstallationId,
        businessDayId,
        shiftId,
        responsibleAttendantId: ctx.actors.attendant.membershipId,
        reason:
          index === 0 ? 'SHIFT_OPEN' : index === readings.length - 1 ? 'SHIFT_CLOSE' : 'DELIVERY',
        readingStatus: 'AVAILABLE',
        readingValue,
        exceptionReason: index === 0 ? 'QA1 deterministic meter fixture' : undefined,
        expectedVersion: shift.version,
      },
      `${keyPrefix}-boundary-${index}`,
      'supervisor',
    );
    if (![200, 201].includes(boundary.response.status))
      throw new Error(JSON.stringify(boundary.body));
  }

  const boundaries = await client.unsafe<{ id: string; effective_at: Date }[]>(`
    select id, effective_at from app.meter_boundaries
    where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      and id in ('${boundaryIds.join("','")}')
  `);
  if (boundaries.length !== boundaryIds.length) {
    throw new Error(`QA1 expected ${boundaryIds.length} persisted meter boundaries`);
  }
  const boundaryById = new Map(boundaries.map((boundary) => [boundary.id, boundary]));
  for (let index = 1; index < boundaryIds.length; index += 1) {
    const previous = boundaryById.get(boundaryIds[index - 1]!);
    const current = boundaryById.get(boundaryIds[index]!);
    if (!previous || !current || current.effective_at.getTime() < previous.effective_at.getTime()) {
      throw new Error('QA1 production boundaries are not monotonically chronological');
    }
  }
  const segmentIds: string[] = [];
  for (let index = 0; index < readings.length - 1; index += 1) {
    const segmentId = randomUUID();
    segmentIds.push(segmentId);
    const segment = await forecourt(
      ctx,
      {
        commandType: 'SealSegment',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        segmentId,
        nozzleId: ctx.nozzleId,
        meterInstallationId: ctx.meterInstallationId,
        businessDayId,
        shiftId,
        openingBoundaryId: boundaryIds[index],
        closingBoundaryId: boundaryIds[index + 1],
        productId: ctx.productId,
        responsibleAttendantId: ctx.actors.attendant.membershipId,
        startAt: boundaryTimes[index],
        endAt: boundaryTimes[index + 1],
        expectedVersion: 0,
      },
      `${keyPrefix}-segment-${index}`,
      'supervisor',
    );
    if (segment.response.status !== 201) throw new Error(JSON.stringify(segment.body));
  }
  return { segmentIds };
}

export async function completeShift(
  client: Sql,
  ctx: Qa1ScenarioContext,
  shiftId: string,
  keyPrefix: string,
  businessDayId = ctx.businessDayId,
): Promise<void> {
  const beforeClose = await currentShiftVersion(client, ctx, shiftId);
  const closed = await forecourt(
    ctx,
    {
      commandType: 'CloseMeters',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      businessDayId,
      shiftId,
      expectedVersion: beforeClose.version,
    },
    `${keyPrefix}-close-meters`,
    'supervisor',
  );
  if (closed.response.status !== 200) throw new Error(JSON.stringify(closed.body));
  const beforeComplete = await currentShiftVersion(client, ctx, shiftId);
  const completed = await forecourt(
    ctx,
    {
      commandType: 'CompleteShift',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      businessDayId,
      shiftId,
      expectedVersion: beforeComplete.version,
    },
    `${keyPrefix}-complete-shift`,
    'supervisor',
  );
  if (completed.response.status !== 200) throw new Error(JSON.stringify(completed.body));
}

export async function createDelivery(
  ctx: Qa1ScenarioContext,
  keyPrefix: string,
  input: { quantityLitres: string; deliveredAt: string; noteQuantityLitres?: string },
): Promise<{ deliveryId: string; allocationId: string }> {
  const result = await inventory(
    ctx,
    {
      commandType: 'CreateDelivery',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      productId: ctx.productId,
      deliveryNoteNumber: `QA1-DN-${keyPrefix}`,
      deliveredAt: input.deliveredAt,
      noteQuantityLitres: input.noteQuantityLitres ?? input.quantityLitres,
      actualQuantityLitres: input.quantityLitres,
      allocations: [{ tankId: ctx.tankId, quantityLitres: input.quantityLitres }],
    },
    `${keyPrefix}-create-delivery`,
  );
  if (result.response.status !== 200 && result.response.status !== 201)
    throw new Error(JSON.stringify(result.body));
  const deliveryId = result.body.deliveryId as string;
  const allocationId = (result.body.allocationIds as string[] | undefined)?.[0];
  if (!deliveryId || !allocationId)
    throw new Error(`CreateDelivery did not return allocation: ${JSON.stringify(result.body)}`);
  return { deliveryId, allocationId };
}

export async function confirmDelivery(
  ctx: Qa1ScenarioContext,
  deliveryId: string,
  key: string,
): Promise<void> {
  const result = await inventory(
    ctx,
    {
      commandType: 'ConfirmDelivery',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      deliveryId,
    },
    key,
  );
  if (result.response.status !== 200) throw new Error(JSON.stringify(result.body));
}

export async function recordReceiptCost(
  ctx: Qa1ScenarioContext,
  allocationId: string,
  amount: string,
  key: string,
): Promise<void> {
  const result = await inventory(
    ctx,
    {
      commandType: 'RecordReceiptCost',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      allocationId,
      amount,
      currency: 'USD',
    },
    key,
  );
  if (result.response.status !== 200) throw new Error(JSON.stringify(result.body));
}

export type PostedSale = {
  reconciliationId: string;
  revisionId: string;
  shiftId: string;
  segmentIds: string[];
  paymentIds: Record<string, string>;
  saleMovementIds: string[];
};

export async function createApprovedSale(
  client: Sql,
  ctx: Qa1ScenarioContext,
  keyPrefix: string,
  input: {
    saleLitres: string;
    payments: Array<{ method: string; amount: string; reference?: string }>;
    post?: boolean;
    completeShiftAfter?: boolean;
    existingShiftId?: string;
    openingReading?: string;
    approve?: boolean;
    segmentBoundaryTimes?: readonly string[];
    businessDayId?: string;
    plannedStartAt?: string;
    plannedEndAt?: string;
  },
): Promise<PostedSale> {
  const businessDayId = input.businessDayId ?? ctx.businessDayId;
  if (!input.existingShiftId) {
    await postOpeningPosition(client, ctx, keyPrefix);
  }
  const { shiftId } = input.existingShiftId
    ? { shiftId: input.existingShiftId }
    : await openBusinessDayAndShift(
        ctx,
        keyPrefix,
        businessDayId,
        input.plannedStartAt ?? QA1_TIMES.opening,
        input.plannedEndAt ?? '2026-09-27T05:00:00.000Z',
      );
  const openingReading = input.openingReading ?? '100000.000';
  const closingReading = new ExactDecimal(openingReading)
    .add(new ExactDecimal(input.saleLitres))
    .toString();
  const { segmentIds } = await sealMeterSegments(
    client,
    ctx,
    shiftId,
    [openingReading, closingReading],
    keyPrefix,
    input.segmentBoundaryTimes,
    businessDayId,
  );
  if (input.completeShiftAfter) await completeShift(client, ctx, shiftId, keyPrefix, businessDayId);

  const reconciliationId = randomUUID();
  const common = { tenantId: ctx.tenantId, stationId: ctx.stationId, reconciliationId };
  const created = await forecourt(
    ctx,
    {
      commandType: 'CreateProductionReconciliation',
      ...common,
      businessDayId,
      shiftId,
      expectedVersion: 0,
    },
    `${keyPrefix}-create-reconciliation`,
    'supervisor',
  );
  if (created.response.status !== 200) throw new Error(JSON.stringify(created.body));

  const draft = await forecourt(
    ctx,
    { commandType: 'SaveReconciliationDraft', ...common, expectedVersion: 0 },
    `${keyPrefix}-draft`,
    'supervisor',
  );
  if (draft.response.status !== 200) throw new Error(JSON.stringify(draft.body));
  const versionAfterDraft = await reconciliationVersion(client, ctx, reconciliationId);
  const attendants = await forecourt(
    ctx,
    {
      commandType: 'SetAttendants',
      ...common,
      expectedVersion: versionAfterDraft,
      attendantIds: [ctx.actors.attendant.membershipId],
    },
    `${keyPrefix}-attendants`,
    'supervisor',
  );
  if (attendants.response.status !== 200) throw new Error(JSON.stringify(attendants.body));
  const versionAfterAttendants = await reconciliationVersion(client, ctx, reconciliationId);
  const readings = await forecourt(
    ctx,
    {
      commandType: 'SaveMeterReadings',
      ...common,
      expectedVersion: versionAfterAttendants,
      readings: [
        {
          nozzleId: ctx.nozzleId,
          productId: ctx.productId,
          shiftId,
          openingReading,
          closingReading,
          sellingPriceId: ctx.priceId,
        },
      ],
    },
    `${keyPrefix}-readings`,
    'supervisor',
  );
  if (readings.response.status !== 200) throw new Error(JSON.stringify(readings.body));
  let version = await reconciliationVersion(client, ctx, reconciliationId);
  const payments = await forecourt(
    ctx,
    {
      commandType: 'SavePaymentAllocations',
      ...common,
      expectedVersion: version,
      payments: input.payments,
    },
    `${keyPrefix}-payments`,
    'supervisor',
  );
  if (payments.response.status !== 200) throw new Error(JSON.stringify(payments.body));
  version = await reconciliationVersion(client, ctx, reconciliationId);
  const expenses = await forecourt(
    ctx,
    { commandType: 'SaveExpenses', ...common, expectedVersion: version, expenses: [] },
    `${keyPrefix}-expenses`,
    'supervisor',
  );
  if (expenses.response.status !== 200) throw new Error(JSON.stringify(expenses.body));
  version = await reconciliationVersion(client, ctx, reconciliationId);
  const cashAmount = input.payments
    .filter((payment) => payment.method === 'CASH')
    .reduce((total, payment) => total.add(new ExactDecimal(payment.amount)), new ExactDecimal('0'))
    .toString();
  const cash = await forecourt(
    ctx,
    {
      commandType: 'SaveCashDeclaration',
      ...common,
      expectedVersion: version,
      countedCash: cashAmount,
    },
    `${keyPrefix}-cash`,
    'supervisor',
  );
  if (cash.response.status !== 200) throw new Error(JSON.stringify(cash.body));
  version = await reconciliationVersion(client, ctx, reconciliationId);
  const explanations = await forecourt(
    ctx,
    {
      commandType: 'SaveVarianceExplanations',
      ...common,
      expectedVersion: version,
      explanations: {},
    },
    `${keyPrefix}-explanations`,
    'supervisor',
  );
  if (explanations.response.status !== 200) throw new Error(JSON.stringify(explanations.body));
  version = await reconciliationVersion(client, ctx, reconciliationId);
  const submitted = await forecourt(
    ctx,
    { commandType: 'SubmitProductionReconciliation', ...common, expectedVersion: version },
    `${keyPrefix}-submit`,
    'supervisor',
  );
  if (submitted.response.status !== 200) throw new Error(JSON.stringify(submitted.body));
  const submittedVersion = await reconciliationVersion(client, ctx, reconciliationId);
  if (input.approve !== false) {
    const approved = await forecourt(
      ctx,
      {
        commandType: 'ApproveProductionReconciliation',
        ...common,
        expectedVersion: submittedVersion,
      },
      `${keyPrefix}-approve`,
      'admin',
    );
    if (approved.response.status !== 200) throw new Error(JSON.stringify(approved.body));
  }
  const revision = await latestRevision(client, ctx, reconciliationId);
  if (input.post !== false) {
    const posted = await forecourt(
      ctx,
      {
        commandType: 'PostReconciliation',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        revisionId: revision.id,
        expectedVersion: revision.version,
      },
      `${keyPrefix}-post`,
      'admin',
    );
    if (posted.response.status !== 200) throw new Error(JSON.stringify(posted.body));
  }
  const saleRows = await client.unsafe<{ id: string }[]>(`
    select id from app.inventory_movements
    where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}'
      and source_type='METER_SEGMENT_SALE'
      and source_id in ('${segmentIds.join("','")}') order by effective_at, id
  `);
  const paymentRows = await client.unsafe<{ id: string; method: string }[]>(`
    select id, method from app.reconciliation_payments
    where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' and reconciliation_id='${reconciliationId}'
    order by id
  `);
  return {
    reconciliationId,
    revisionId: revision.id,
    shiftId,
    segmentIds,
    paymentIds: Object.fromEntries(paymentRows.map((row) => [row.method, row.id])),
    saleMovementIds: saleRows.map((row) => row.id),
  };
}

async function reconciliationVersion(
  client: Sql,
  ctx: Qa1ScenarioContext,
  reconciliationId: string,
): Promise<number> {
  const rows = await client.unsafe<{ version: number }[]>(`
    select version from app.reconciliations
    where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' and id='${reconciliationId}'
  `);
  if (!rows[0]) throw new Error(`QA1 reconciliation ${reconciliationId} was not found`);
  return rows[0].version;
}

async function latestRevision(client: Sql, ctx: Qa1ScenarioContext, reconciliationId: string) {
  const rows = await client.unsafe<{ id: string; version: number; state: string }[]>(`
    select id, version, state from app.reconciliation_revisions
    where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' and reconciliation_id='${reconciliationId}'
    order by revision desc limit 1
  `);
  if (!rows[0]) throw new Error(`QA1 revision for ${reconciliationId} was not found`);
  return rows[0];
}

export async function currentRevision(
  client: Sql,
  ctx: Qa1ScenarioContext,
  reconciliationId: string,
) {
  return latestRevision(client, ctx, reconciliationId);
}
