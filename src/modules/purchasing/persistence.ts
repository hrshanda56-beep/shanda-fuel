import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import { hasAlternateApprover } from '../../platform/security/separation-of-duties';
import type { PurchasingCommandContext, PurchasingTransaction } from './application';
import type { PurchasingCommandInput } from './contracts';
import {
  assertApproverAllowed,
  assertOrderDates,
  assertPurchaseOrderTransition,
  isAmendableState,
  shortClosedLitres,
  validateLines,
  type PurchaseOrderState,
  type ValidatedLine,
} from './domain';

function actorId(context: PurchasingCommandContext): string {
  return context.authority.membership.membershipId;
}

function assertVersion(actual: number | string, expected: number): void {
  if (Number(actual) !== expected) {
    throw new AppError(
      'CONFLICT',
      'The purchase order changed since it was loaded; reload and retry',
      { expectedVersion: expected, actualVersion: Number(actual) },
    );
  }
}

type PurchaseOrderRow = {
  id: string;
  supplier_id: string;
  order_number: string;
  order_date: string;
  expected_delivery_date: string | null;
  notes: string | null;
  state: PurchaseOrderState;
  version: number | string;
  revision_no: number;
  created_by: string;
  submitted_by: string | null;
};

/** Deterministic lock order: purchase order first, then its lines, then deliveries by id. */
async function lockPurchaseOrder(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  purchaseOrderId: string,
): Promise<PurchaseOrderRow> {
  const rows = await transaction.execute<PurchaseOrderRow>(sql`
    select id, supplier_id, order_number, order_date, expected_delivery_date, notes, state,
           version, revision_no, created_by, submitted_by
    from app.purchase_orders
    where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
      and id = ${purchaseOrderId}
    for update
  `);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'The purchase order was not found at this station');
  return rows[0];
}

type LineRow = {
  id: string;
  line_number: number;
  product_id: string;
  ordered_litres: string;
  agreed_unit_price: string | null;
  status: 'ACTIVE' | 'REMOVED';
  short_closed_litres: string | null;
};

async function loadLines(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  purchaseOrderId: string,
): Promise<LineRow[]> {
  return [
    ...(await transaction.execute<LineRow>(sql`
      select id, line_number, product_id, ordered_litres::text as ordered_litres,
             agreed_unit_price::text as agreed_unit_price, status,
             short_closed_litres::text as short_closed_litres
      from app.purchase_order_lines
      where tenant_id = ${context.tenantId} and purchase_order_id = ${purchaseOrderId}
      order by line_number
      for update
    `)),
  ];
}

/** Confirmed (physical authority) and draft linked litres per active line. */
export async function loadReceiptByLine(
  transaction: Pick<PurchasingTransaction, 'execute'>,
  tenantId: string,
  purchaseOrderId: string,
): Promise<Map<string, { confirmed: string; draft: string }>> {
  const rows = await transaction.execute<{ line_id: string; confirmed: string; draft: string }>(sql`
    select l.id as line_id,
      coalesce(sum(d.actual_quantity_litres) filter (where d.status = 'CONFIRMED'), 0)::text as confirmed,
      coalesce(sum(d.actual_quantity_litres) filter (where d.status = 'DRAFT'), 0)::text as draft
    from app.purchase_order_lines l
    left join app.purchase_order_delivery_links k
      on k.tenant_id = l.tenant_id and k.purchase_order_line_id = l.id and k.state = 'ACTIVE'
    left join app.fuel_deliveries d on d.tenant_id = k.tenant_id and d.id = k.delivery_id
    where l.tenant_id = ${tenantId} and l.purchase_order_id = ${purchaseOrderId}
    group by l.id
  `);
  return new Map(
    [...rows].map((row) => [row.line_id, { confirmed: row.confirmed, draft: row.draft }]),
  );
}

async function assertActiveProducts(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  productIds: readonly string[],
): Promise<void> {
  for (const productId of [...new Set(productIds)].sort()) {
    const rows = await transaction.execute<{ status: string }>(sql`
      select status from app.products
      where tenant_id = ${context.tenantId} and id = ${productId}
    `);
    if (!rows[0]) throw new AppError('NOT_FOUND', 'A product on the order was not found');
    if (rows[0].status !== 'ACTIVE') {
      throw new AppError('INVARIANT_VIOLATION', 'A product on the order is inactive');
    }
  }
}

async function snapshotOf(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  purchaseOrderId: string,
): Promise<Record<string, unknown>> {
  const rows = await transaction.execute<PurchaseOrderRow>(sql`
    select id, supplier_id, order_number, order_date, expected_delivery_date, notes, state,
           version, revision_no, created_by, submitted_by
    from app.purchase_orders
    where tenant_id = ${context.tenantId} and id = ${purchaseOrderId}
  `);
  const header = rows[0]!;
  const lines = await loadLines(transaction, context, purchaseOrderId);
  return {
    orderNumber: header.order_number,
    supplierId: header.supplier_id,
    orderDate: header.order_date,
    expectedDeliveryDate: header.expected_delivery_date,
    notes: header.notes,
    state: header.state,
    revisionNo: header.revision_no,
    lines: lines.map((line) => ({
      lineId: line.id,
      lineNumber: line.line_number,
      productId: line.product_id,
      orderedLitres: line.ordered_litres,
      agreedUnitPrice: line.agreed_unit_price,
      status: line.status,
    })),
  };
}

async function writeRevision(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  purchaseOrderId: string,
  revisionNo: number,
  reason: string | null,
): Promise<void> {
  const snapshot = await snapshotOf(transaction, context, purchaseOrderId);
  await transaction.execute(sql`
    insert into app.purchase_order_revisions (
      id, tenant_id, purchase_order_id, revision_no, snapshot, reason, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${purchaseOrderId}, ${revisionNo},
      ${JSON.stringify(snapshot)}::jsonb, ${reason}, ${actorId(context)}
    )
  `);
}

function lineResult(line: LineRow) {
  return {
    lineId: line.id,
    lineNumber: line.line_number,
    productId: line.product_id,
    orderedLitres: line.ordered_litres,
    agreedUnitPrice: line.agreed_unit_price,
    status: line.status,
  };
}

export async function createPurchaseOrderInTransaction(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  input: PurchasingCommandInput<'CreatePurchaseOrder'>,
) {
  const expectedDeliveryDate = input.expectedDeliveryDate ?? null;
  assertOrderDates(input.orderDate, expectedDeliveryDate);
  const lines = validateLines(input.lines);
  const supplier = await transaction.execute<{ status: string }>(sql`
    select status from app.suppliers
    where tenant_id = ${context.tenantId} and id = ${input.supplierId}
  `);
  if (!supplier[0]) throw new AppError('NOT_FOUND', 'The supplier was not found');
  if (supplier[0].status !== 'ACTIVE') {
    throw new AppError('INVARIANT_VIOLATION', 'The supplier is inactive');
  }
  await assertActiveProducts(
    transaction,
    context,
    lines.map((line) => line.productId),
  );
  const orderNumber =
    input.orderNumber ??
    `PO-${input.orderDate.replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const duplicate = await transaction.execute(sql`
    select 1 from app.purchase_orders
    where tenant_id = ${context.tenantId} and order_number = ${orderNumber}
  `);
  if (duplicate.length > 0) {
    throw new AppError('CONFLICT', 'A purchase order with this number already exists');
  }
  const purchaseOrderId = randomUUID();
  await transaction.execute(sql`
    insert into app.purchase_orders (
      id, tenant_id, legal_entity_id, station_id, supplier_id, order_number, order_date,
      expected_delivery_date, notes, created_by
    ) values (
      ${purchaseOrderId}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
      ${input.supplierId}, ${orderNumber}, ${input.orderDate}, ${expectedDeliveryDate},
      ${input.notes ?? null}, ${actorId(context)}
    )
  `);
  let lineNumber = 0;
  for (const line of lines) {
    lineNumber += 1;
    await transaction.execute(sql`
      insert into app.purchase_order_lines (
        id, tenant_id, purchase_order_id, line_number, product_id, ordered_litres,
        agreed_unit_price
      ) values (
        ${randomUUID()}, ${context.tenantId}, ${purchaseOrderId}, ${lineNumber},
        ${line.productId}, ${line.orderedLitres}, ${line.agreedUnitPrice}
      )
    `);
  }
  await writeRevision(transaction, context, purchaseOrderId, 1, null);
  return {
    purchaseOrderId,
    orderNumber,
    state: 'DRAFT' as const,
    version: 0,
    revisionNo: 1,
    lines: (await loadLines(transaction, context, purchaseOrderId)).map(lineResult),
  };
}

export async function submitPurchaseOrderInTransaction(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  input: PurchasingCommandInput<'SubmitPurchaseOrder'>,
) {
  const order = await lockPurchaseOrder(transaction, context, input.purchaseOrderId);
  assertVersion(order.version, input.expectedVersion);
  assertPurchaseOrderTransition(order.state, 'SUBMITTED');
  const lines = (await loadLines(transaction, context, order.id)).filter(
    (line) => line.status === 'ACTIVE',
  );
  if (lines.length === 0) {
    throw new AppError('INVARIANT_VIOLATION', 'A purchase order needs at least one active line');
  }
  await transaction.execute(sql`
    update app.purchase_orders
    set state = 'SUBMITTED', submitted_by = ${actorId(context)}, submitted_at = now(),
        version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${order.id}
  `);
  return {
    purchaseOrderId: order.id,
    state: 'SUBMITTED' as const,
    version: Number(order.version) + 1,
  };
}

export async function approvePurchaseOrderInTransaction(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  input: PurchasingCommandInput<'ApprovePurchaseOrder'>,
) {
  const order = await lockPurchaseOrder(transaction, context, input.purchaseOrderId);
  assertVersion(order.version, input.expectedVersion);
  assertPurchaseOrderTransition(order.state, 'APPROVED');
  const submitter = order.submitted_by ?? order.created_by;
  const alternateApproverExists = await hasAlternateApprover(transaction, {
    tenantId: context.tenantId,
    stationId: context.stationId,
    excludeMembershipId: submitter,
    permission: 'purchase_order.approve',
  });
  assertApproverAllowed({
    submitterMembershipId: submitter,
    approverMembershipId: actorId(context),
    alternateApproverExists,
  });
  // Reaching here as the submitter means no one else could approve (a solo operator). That is
  // allowed, but only with a stated reason, which the command audit records.
  if (submitter === actorId(context) && !input.selfApprovalReason) {
    throw new AppError(
      'VALIDATION_FAILED',
      'You sent this order and nobody else can approve it. Say why you are approving it yourself.',
    );
  }
  await transaction.execute(sql`
    update app.purchase_orders
    set state = 'APPROVED', approved_by = ${actorId(context)}, approved_at = now(),
        version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${order.id}
  `);
  return {
    purchaseOrderId: order.id,
    state: 'APPROVED' as const,
    version: Number(order.version) + 1,
  };
}

export async function amendPurchaseOrderInTransaction(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  input: PurchasingCommandInput<'AmendPurchaseOrder'>,
) {
  const order = await lockPurchaseOrder(transaction, context, input.purchaseOrderId);
  assertVersion(order.version, input.expectedVersion);
  if (!isAmendableState(order.state)) {
    throw new AppError('CONFLICT', `A ${order.state} purchase order cannot be amended`);
  }
  const orderDate = input.orderDate ?? order.order_date;
  const expectedDeliveryDate =
    input.expectedDeliveryDate === undefined
      ? order.expected_delivery_date
      : input.expectedDeliveryDate;
  assertOrderDates(orderDate, expectedDeliveryDate);
  const wanted = validateLines(input.lines);
  const existing = await loadLines(transaction, context, order.id);
  const activeById = new Map(
    existing.filter((line) => line.status === 'ACTIVE').map((line) => [line.id, line]),
  );
  const keptIds = new Set<string>();
  const additions: ValidatedLine[] = [];
  for (const line of wanted) {
    if (line.lineId) {
      const current = activeById.get(line.lineId);
      if (!current) {
        throw new AppError('NOT_FOUND', 'An amended line does not belong to this order');
      }
      if (current.product_id !== line.productId) {
        throw new AppError(
          'VALIDATION_FAILED',
          'The product of an existing line cannot change; remove the line and add a new one',
        );
      }
      keptIds.add(line.lineId);
    } else {
      additions.push(line);
    }
  }
  await assertActiveProducts(
    transaction,
    context,
    additions.map((line) => line.productId),
  );
  for (const [lineId, line] of activeById) {
    if (keptIds.has(lineId)) continue;
    const linked = await transaction.execute(sql`
      select 1 from app.purchase_order_delivery_links
      where tenant_id = ${context.tenantId} and purchase_order_line_id = ${lineId}
        and state = 'ACTIVE'
    `);
    if (linked.length > 0) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        `Line ${line.line_number} has linked deliveries and cannot be removed`,
      );
    }
    await transaction.execute(sql`
      update app.purchase_order_lines set status = 'REMOVED', updated_at = now()
      where tenant_id = ${context.tenantId} and id = ${lineId}
    `);
  }
  for (const line of wanted) {
    if (!line.lineId) continue;
    await transaction.execute(sql`
      update app.purchase_order_lines
      set ordered_litres = ${line.orderedLitres}, agreed_unit_price = ${line.agreedUnitPrice},
          updated_at = now()
      where tenant_id = ${context.tenantId} and id = ${line.lineId}
    `);
  }
  let lineNumber = Math.max(0, ...existing.map((line) => line.line_number));
  for (const line of additions) {
    lineNumber += 1;
    await transaction.execute(sql`
      insert into app.purchase_order_lines (
        id, tenant_id, purchase_order_id, line_number, product_id, ordered_litres,
        agreed_unit_price
      ) values (
        ${randomUUID()}, ${context.tenantId}, ${order.id}, ${lineNumber}, ${line.productId},
        ${line.orderedLitres}, ${line.agreedUnitPrice}
      )
    `);
  }
  // An approved order returns to SUBMITTED so the new terms are approved again; the person who
  // amends becomes the submitter for separation of duties.
  const nextState: PurchaseOrderState = order.state === 'DRAFT' ? 'DRAFT' : 'SUBMITTED';
  if (nextState !== order.state) assertPurchaseOrderTransition(order.state, nextState);
  const notes = input.notes === undefined ? order.notes : input.notes;
  const revisionNo = order.revision_no + 1;
  await transaction.execute(sql`
    update app.purchase_orders
    set order_date = ${orderDate}, expected_delivery_date = ${expectedDeliveryDate},
        notes = ${notes}, state = ${nextState}, revision_no = ${revisionNo},
        submitted_by = ${nextState === 'DRAFT' ? order.submitted_by : actorId(context)},
        submitted_at = ${nextState === 'DRAFT' ? sql`submitted_at` : sql`now()`},
        approved_by = null, approved_at = null,
        version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${order.id}
  `);
  await writeRevision(transaction, context, order.id, revisionNo, input.reason);
  return {
    purchaseOrderId: order.id,
    state: nextState,
    version: Number(order.version) + 1,
    revisionNo,
    lines: (await loadLines(transaction, context, order.id)).map(lineResult),
  };
}

export async function cancelPurchaseOrderInTransaction(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  input: PurchasingCommandInput<'CancelPurchaseOrder'>,
) {
  const order = await lockPurchaseOrder(transaction, context, input.purchaseOrderId);
  assertVersion(order.version, input.expectedVersion);
  assertPurchaseOrderTransition(order.state, 'CANCELLED');
  const confirmed = await transaction.execute(sql`
    select 1
    from app.purchase_order_delivery_links k
    join app.fuel_deliveries d on d.tenant_id = k.tenant_id and d.id = k.delivery_id
    where k.tenant_id = ${context.tenantId} and k.purchase_order_id = ${order.id}
      and k.state = 'ACTIVE' and d.status = 'CONFIRMED'
  `);
  if (confirmed.length > 0) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Fuel has already been received against this order; close it instead of cancelling',
    );
  }
  await transaction.execute(sql`
    update app.purchase_order_delivery_links
    set state = 'UNLINKED', unlinked_by = ${actorId(context)}, unlinked_at = now(),
        unlink_reason = 'Purchase order cancelled'
    where tenant_id = ${context.tenantId} and purchase_order_id = ${order.id}
      and state = 'ACTIVE'
  `);
  await transaction.execute(sql`
    update app.purchase_orders
    set state = 'CANCELLED', cancelled_by = ${actorId(context)}, cancelled_at = now(),
        cancellation_reason = ${input.reason}, version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${order.id}
  `);
  return {
    purchaseOrderId: order.id,
    state: 'CANCELLED' as const,
    version: Number(order.version) + 1,
  };
}

export async function closePurchaseOrderInTransaction(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  input: PurchasingCommandInput<'ClosePurchaseOrder'>,
) {
  const order = await lockPurchaseOrder(transaction, context, input.purchaseOrderId);
  assertVersion(order.version, input.expectedVersion);
  assertPurchaseOrderTransition(order.state, 'CLOSED');
  const lines = (await loadLines(transaction, context, order.id)).filter(
    (line) => line.status === 'ACTIVE',
  );
  const receipts = await loadReceiptByLine(transaction, context.tenantId, order.id);
  const shortClosed: { lineId: string; lineNumber: number; shortClosedLitres: string }[] = [];
  for (const line of lines) {
    const litres = shortClosedLitres(line.ordered_litres, receipts.get(line.id)?.confirmed ?? '0');
    await transaction.execute(sql`
      update app.purchase_order_lines
      set short_closed_litres = ${litres}, updated_at = now()
      where tenant_id = ${context.tenantId} and id = ${line.id}
    `);
    shortClosed.push({ lineId: line.id, lineNumber: line.line_number, shortClosedLitres: litres });
  }
  await transaction.execute(sql`
    update app.purchase_orders
    set state = 'CLOSED', closed_by = ${actorId(context)}, closed_at = now(),
        close_reason = ${input.reason}, version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${order.id}
  `);
  return {
    purchaseOrderId: order.id,
    state: 'CLOSED' as const,
    version: Number(order.version) + 1,
    shortClosed,
  };
}

export async function linkDeliveryToPurchaseOrderInTransaction(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  input: PurchasingCommandInput<'LinkDeliveryToPurchaseOrder'>,
) {
  const order = await lockPurchaseOrder(transaction, context, input.purchaseOrderId);
  if (order.state !== 'APPROVED') {
    throw new AppError('CONFLICT', 'Deliveries can only be linked to an approved purchase order');
  }
  const lines = await loadLines(transaction, context, order.id);
  const line = lines.find((row) => row.id === input.purchaseOrderLineId);
  if (!line || line.status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', 'The purchase order line was not found');
  }
  const deliveries = await transaction.execute<{
    id: string;
    station_id: string;
    product_id: string;
    status: string;
    actual_quantity_litres: string;
    supplier_id: string | null;
  }>(sql`
    select id, station_id, product_id, status, supplier_id::text as supplier_id,
      actual_quantity_litres::text as actual_quantity_litres
    from app.fuel_deliveries
    where tenant_id = ${context.tenantId} and id = ${input.deliveryId}
    for update
  `);
  const delivery = deliveries[0];
  if (!delivery) throw new AppError('NOT_FOUND', 'The delivery was not found');
  if (delivery.station_id !== context.stationId) {
    throw new AppError('INVARIANT_VIOLATION', 'The delivery belongs to a different station');
  }
  if (delivery.status !== 'DRAFT' && delivery.status !== 'CONFIRMED') {
    throw new AppError('INVARIANT_VIOLATION', 'Only draft or confirmed deliveries can be linked');
  }
  if (delivery.product_id !== line.product_id) {
    throw new AppError('INVARIANT_VIOLATION', 'The delivery product differs from the order line');
  }
  if (delivery.supplier_id !== order.supplier_id) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'The delivery supplier differs from the purchase order supplier',
    );
  }
  const already = await transaction.execute(sql`
    select 1 from app.purchase_order_delivery_links
    where tenant_id = ${context.tenantId} and delivery_id = ${delivery.id} and state = 'ACTIVE'
  `);
  if (already.length > 0) {
    throw new AppError('CONFLICT', 'The delivery is already linked to a purchase order line');
  }
  const linkId = randomUUID();
  await transaction.execute(sql`
    insert into app.purchase_order_delivery_links (
      id, tenant_id, station_id, purchase_order_id, purchase_order_line_id, delivery_id,
      product_id, linked_by
    ) values (
      ${linkId}, ${context.tenantId}, ${context.stationId}, ${order.id}, ${line.id},
      ${delivery.id}, ${delivery.product_id}, ${actorId(context)}
    )
  `);
  return {
    linkId,
    purchaseOrderId: order.id,
    purchaseOrderLineId: line.id,
    deliveryId: delivery.id,
    deliveryStatus: delivery.status,
    deliveryActualLitres: delivery.actual_quantity_litres,
    version: Number(order.version),
  };
}

export async function unlinkDeliveryFromPurchaseOrderInTransaction(
  transaction: PurchasingTransaction,
  context: PurchasingCommandContext,
  input: PurchasingCommandInput<'UnlinkDeliveryFromPurchaseOrder'>,
) {
  const order = await lockPurchaseOrder(transaction, context, input.purchaseOrderId);
  if (order.state !== 'APPROVED' && order.state !== 'SUBMITTED') {
    throw new AppError('CONFLICT', `A ${order.state} purchase order keeps its delivery links`);
  }
  const links = await transaction.execute<{ id: string }>(sql`
    select id from app.purchase_order_delivery_links
    where tenant_id = ${context.tenantId} and purchase_order_id = ${order.id}
      and delivery_id = ${input.deliveryId} and state = 'ACTIVE'
    for update
  `);
  if (!links[0]) throw new AppError('NOT_FOUND', 'The delivery is not linked to this order');
  await transaction.execute(sql`
    update app.purchase_order_delivery_links
    set state = 'UNLINKED', unlinked_by = ${actorId(context)}, unlinked_at = now(),
        unlink_reason = ${input.reason}
    where tenant_id = ${context.tenantId} and id = ${links[0].id}
  `);
  return {
    linkId: links[0].id,
    purchaseOrderId: order.id,
    deliveryId: input.deliveryId,
    state: 'UNLINKED' as const,
    version: Number(order.version),
  };
}
