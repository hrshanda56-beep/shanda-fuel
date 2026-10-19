import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { authorize } from '../../platform/security/permissions';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import type { AuthenticatedActorContext } from '../identity';
import { resolvePurchasingReadContext } from './read-context';
import type { PurchasingCommandContext } from './application';
import {
  PURCHASE_ORDER_STATES,
  computeLineReceipt,
  deriveOrderReceiptStatus,
  displayState,
  type PurchaseOrderState,
} from './domain';
import { loadReceiptByLine } from './persistence';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const scope = z.object({ tenantId: uuid, stationId: uuid });

export const purchaseOrderReferenceQuerySchema = scope;

export const purchaseOrderListQuerySchema = scope.extend({
  state: z.enum(PURCHASE_ORDER_STATES).optional(),
  supplierId: uuid.optional(),
  from: date.optional(),
  to: date.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const purchaseOrderDetailQuerySchema = scope.extend({ purchaseOrderId: uuid });

async function readContext(
  request: Request,
  input: { tenantId: string; stationId: string },
  actor?: AuthenticatedActorContext,
): Promise<PurchasingCommandContext> {
  const context = await resolvePurchasingReadContext({
    request,
    tenantId: input.tenantId,
    stationId: input.stationId,
    authenticatedActor: actor,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'purchase_order.view',
    requestedScope: context.scope,
  });
  return context;
}

type HeaderRow = {
  id: string;
  supplier_id: string;
  supplier_code: string;
  supplier_name: string;
  order_number: string;
  order_date: string;
  expected_delivery_date: string | null;
  notes: string | null;
  state: PurchaseOrderState;
  version: number | string;
  revision_no: number;
  created_by: string;
  created_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  closed_at: string | null;
  close_reason: string | null;
};

const headerColumns = sql`
  p.id, p.supplier_id, s.code as supplier_code, s.legal_name as supplier_name, p.order_number,
  p.order_date, p.expected_delivery_date, p.notes, p.state, p.version, p.revision_no,
  p.created_by, p.created_at::text as created_at, p.submitted_by,
  p.submitted_at::text as submitted_at, p.approved_by, p.approved_at::text as approved_at,
  p.cancelled_at::text as cancelled_at, p.cancellation_reason, p.closed_at::text as closed_at,
  p.close_reason`;

type LineRow = {
  id: string;
  purchase_order_id: string;
  line_number: number;
  product_id: string;
  product_code: string;
  product_name: string;
  ordered_litres: string;
  agreed_unit_price: string | null;
  status: string;
  short_closed_litres: string | null;
};

async function linesWithReceipt(
  transaction: Parameters<Parameters<typeof withTenantTransaction>[1]>[0],
  tenantId: string,
  purchaseOrderId: string,
) {
  const lines = await transaction.execute<LineRow>(sql`
    select l.id, l.purchase_order_id, l.line_number, l.product_id, pr.code as product_code,
      pr.name as product_name, l.ordered_litres::text as ordered_litres,
      l.agreed_unit_price::text as agreed_unit_price, l.status,
      l.short_closed_litres::text as short_closed_litres
    from app.purchase_order_lines l
    join app.products pr on pr.tenant_id = l.tenant_id and pr.id = l.product_id
    where l.tenant_id = ${tenantId} and l.purchase_order_id = ${purchaseOrderId}
    order by l.line_number
  `);
  const receipts = await loadReceiptByLine(transaction, tenantId, purchaseOrderId);
  return [...lines].map((line) => {
    const receipt = computeLineReceipt({
      orderedLitres: line.ordered_litres,
      confirmedLitres: receipts.get(line.id)?.confirmed ?? '0',
      draftLitres: receipts.get(line.id)?.draft ?? '0',
      shortClosedLitres: line.short_closed_litres,
    });
    return {
      lineId: line.id,
      lineNumber: line.line_number,
      productId: line.product_id,
      productCode: line.product_code,
      productName: line.product_name,
      orderedLitres: line.ordered_litres,
      agreedUnitPrice: line.agreed_unit_price,
      status: line.status,
      ...receipt,
    };
  });
}

function headerResult(row: HeaderRow, lines: Awaited<ReturnType<typeof linesWithReceipt>>) {
  const activeLines = lines.filter((line) => line.status === 'ACTIVE');
  const receiptStatus = deriveOrderReceiptStatus(activeLines);
  return {
    purchaseOrderId: row.id,
    orderNumber: row.order_number,
    supplierId: row.supplier_id,
    supplierCode: row.supplier_code,
    supplierName: row.supplier_name,
    orderDate: row.order_date,
    expectedDeliveryDate: row.expected_delivery_date,
    notes: row.notes,
    state: row.state,
    /** APPROVED orders show PARTIALLY_RECEIVED/RECEIVED once confirmed deliveries arrive. */
    displayState: displayState(row.state, receiptStatus),
    receiptStatus,
    version: Number(row.version),
    revisionNo: row.revision_no,
    createdBy: row.created_by,
    createdAt: row.created_at,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    closedAt: row.closed_at,
    closeReason: row.close_reason,
    lines,
  };
}

export async function listPurchaseOrdersFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
) {
  const input = purchaseOrderListQuerySchema.parse(rawInput);
  const context = await readContext(request, input, actor);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<HeaderRow>(sql`
      select ${headerColumns}
      from app.purchase_orders p
      join app.suppliers s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
      where p.tenant_id = ${context.tenantId} and p.station_id = ${context.stationId}
        ${input.state ? sql`and p.state = ${input.state}` : sql``}
        ${input.supplierId ? sql`and p.supplier_id = ${input.supplierId}` : sql``}
        ${input.from ? sql`and p.order_date >= ${input.from}` : sql``}
        ${input.to ? sql`and p.order_date <= ${input.to}` : sql``}
      order by p.order_date desc, p.created_at desc
      limit ${input.limit}
    `);
    const orders = [];
    for (const row of rows) {
      orders.push(headerResult(row, await linesWithReceipt(transaction, context.tenantId, row.id)));
    }
    return { orders };
  });
}

export async function getPurchaseOrderDetailFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
) {
  const input = purchaseOrderDetailQuerySchema.parse(rawInput);
  const context = await readContext(request, input, actor);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<HeaderRow>(sql`
      select ${headerColumns}
      from app.purchase_orders p
      join app.suppliers s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
      where p.tenant_id = ${context.tenantId} and p.station_id = ${context.stationId}
        and p.id = ${input.purchaseOrderId}
    `);
    if (!rows[0]) throw new AppError('NOT_FOUND', 'The purchase order was not found');
    const lines = await linesWithReceipt(transaction, context.tenantId, input.purchaseOrderId);
    const links = await transaction.execute<{
      id: string;
      purchase_order_line_id: string;
      delivery_id: string;
      delivery_note_number: string;
      delivery_status: string;
      actual_quantity_litres: string;
      state: string;
      linked_at: string;
      unlinked_at: string | null;
      unlink_reason: string | null;
    }>(sql`
      select k.id, k.purchase_order_line_id, k.delivery_id, d.delivery_note_number,
        d.status as delivery_status, d.actual_quantity_litres::text as actual_quantity_litres,
        k.state, k.linked_at::text as linked_at, k.unlinked_at::text as unlinked_at,
        k.unlink_reason
      from app.purchase_order_delivery_links k
      join app.fuel_deliveries d on d.tenant_id = k.tenant_id and d.id = k.delivery_id
      where k.tenant_id = ${context.tenantId} and k.purchase_order_id = ${input.purchaseOrderId}
      order by k.linked_at
    `);
    const revisions = await transaction.execute<{
      revision_no: number;
      reason: string | null;
      actor_membership_id: string;
      created_at: string;
      snapshot: unknown;
    }>(sql`
      select revision_no, reason, actor_membership_id, created_at::text as created_at, snapshot
      from app.purchase_order_revisions
      where tenant_id = ${context.tenantId} and purchase_order_id = ${input.purchaseOrderId}
      order by revision_no
    `);
    return {
      ...headerResult(rows[0], lines),
      deliveries: [...links].map((row) => ({
        linkId: row.id,
        purchaseOrderLineId: row.purchase_order_line_id,
        deliveryId: row.delivery_id,
        deliveryNoteNumber: row.delivery_note_number,
        deliveryStatus: row.delivery_status,
        actualQuantityLitres: row.actual_quantity_litres,
        state: row.state,
        linkedAt: row.linked_at,
        unlinkedAt: row.unlinked_at,
        unlinkReason: row.unlink_reason,
      })),
      revisions: [...revisions].map((row) => ({
        revisionNo: row.revision_no,
        reason: row.reason,
        actorMembershipId: row.actor_membership_id,
        createdAt: row.created_at,
        snapshot: row.snapshot,
      })),
    };
  });
}

export async function getPurchaseOrderReferenceFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
) {
  const input = purchaseOrderReferenceQuerySchema.parse(rawInput);
  const context = await readContext(request, input, actor);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const suppliers = await transaction.execute<{
      id: string;
      code: string;
      legal_name: string;
    }>(sql`
      select id, code, legal_name from app.suppliers
      where tenant_id = ${context.tenantId} and status = 'ACTIVE' order by code
    `);
    const products = await transaction.execute<{ id: string; code: string; name: string }>(sql`
      select id, code, name from app.products
      where tenant_id = ${context.tenantId} and status = 'ACTIVE' order by code
    `);
    const deliveries = await transaction.execute<{
      id: string;
      delivery_note_number: string;
      product_id: string;
      status: string;
      actual_quantity_litres: string;
      business_date: string;
    }>(sql`
      select d.id, d.delivery_note_number, d.product_id, d.status,
        d.actual_quantity_litres::text as actual_quantity_litres, d.business_date
      from app.fuel_deliveries d
      where d.tenant_id = ${context.tenantId} and d.station_id = ${context.stationId}
        and d.status in ('DRAFT', 'CONFIRMED')
        and not exists (
          select 1 from app.purchase_order_delivery_links k
          where k.tenant_id = d.tenant_id and k.delivery_id = d.id and k.state = 'ACTIVE'
        )
      order by d.business_date desc, d.delivery_note_number
      limit 100
    `);
    return {
      states: PURCHASE_ORDER_STATES,
      suppliers: [...suppliers].map((row) => ({
        id: row.id,
        code: row.code,
        legalName: row.legal_name,
      })),
      products: [...products].map((row) => ({ id: row.id, code: row.code, name: row.name })),
      linkableDeliveries: [...deliveries].map((row) => ({
        id: row.id,
        deliveryNoteNumber: row.delivery_note_number,
        productId: row.product_id,
        status: row.status,
        actualQuantityLitres: row.actual_quantity_litres,
        businessDate: row.business_date,
      })),
    };
  });
}
