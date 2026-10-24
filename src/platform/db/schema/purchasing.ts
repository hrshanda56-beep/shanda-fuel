import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { memberships, stations } from './a1';
import { products } from './a3';
import { fuelDeliveries } from './a4';
import { suppliers } from './a7';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });
const litres = (name: string) => numeric(name, { precision: 18, scale: 3 });
const unitPrice = (name: string) => numeric(name, { precision: 20, scale: 8 });

/**
 * Purchase order head (ADR-018 D4). Commercial intent only: it never writes inventory, cash,
 * supplier-ledger, or any other financial row. Received state is derived from confirmed linked
 * deliveries and is never stored here.
 */
export const purchaseOrders = appSchema.table(
  'purchase_orders',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    orderNumber: text('order_number').notNull(),
    orderDate: text('order_date').notNull(),
    expectedDeliveryDate: text('expected_delivery_date'),
    currency: text('currency').notNull().default('USD'),
    notes: text('notes'),
    state: text('state').notNull().default('DRAFT'),
    version: integer('version').notNull().default(0),
    revisionNo: integer('revision_no').notNull().default(1),
    createdBy: uuid('created_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    submittedBy: uuid('submitted_by'),
    submittedAt: utcTimestamp('submitted_at'),
    approvedBy: uuid('approved_by'),
    approvedAt: utcTimestamp('approved_at'),
    cancelledBy: uuid('cancelled_by'),
    cancelledAt: utcTimestamp('cancelled_at'),
    cancellationReason: text('cancellation_reason'),
    closedBy: uuid('closed_by'),
    closedAt: utcTimestamp('closed_at'),
    closeReason: text('close_reason'),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('purchase_orders_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('purchase_orders_tenant_station_id_id_uidx').on(
      table.tenantId,
      table.stationId,
      table.id,
    ),
    unique('purchase_orders_tenant_number_uidx').on(table.tenantId, table.orderNumber),
    index('purchase_orders_tenant_station_state_idx').on(
      table.tenantId,
      table.stationId,
      table.state,
    ),
    index('purchase_orders_tenant_supplier_idx').on(table.tenantId, table.supplierId),
    check('purchase_orders_number_nonempty_ck', sql`btrim(${table.orderNumber}) <> ''`),
    check('purchase_orders_currency_ck', sql`${table.currency} = 'USD'`),
    check(
      'purchase_orders_state_ck',
      sql`${table.state} in ('DRAFT','SUBMITTED','APPROVED','CANCELLED','CLOSED')`,
    ),
    check('purchase_orders_revision_ck', sql`${table.revisionNo} >= 1`),
    check(
      'purchase_orders_dates_ck',
      sql`${table.expectedDeliveryDate} is null or ${table.expectedDeliveryDate} >= ${table.orderDate}`,
    ),
    check(
      'purchase_orders_cancel_provenance_ck',
      sql`${table.state} <> 'CANCELLED' or (${table.cancelledBy} is not null and ${table.cancelledAt} is not null and btrim(coalesce(${table.cancellationReason}, '')) <> '')`,
    ),
    check(
      'purchase_orders_close_provenance_ck',
      sql`${table.state} <> 'CLOSED' or (${table.closedBy} is not null and ${table.closedAt} is not null and btrim(coalesce(${table.closeReason}, '')) <> '')`,
    ),
    check(
      'purchase_orders_approval_provenance_ck',
      sql`${table.state} <> 'APPROVED' or (${table.approvedBy} is not null and ${table.approvedAt} is not null)`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'purchase_orders_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'purchase_orders_supplier_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'purchase_orders_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.submittedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'purchase_orders_submitted_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'purchase_orders_approved_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.cancelledBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'purchase_orders_cancelled_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.closedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'purchase_orders_closed_by_fk',
    }),
  ],
);

/**
 * Current lines of a purchase order. A line keeps its identity and product for life; amendments
 * change quantities/price through AmendPurchaseOrder (history lives in purchase_order_revisions)
 * and removal is a status change, never a delete.
 */
export const purchaseOrderLines = appSchema.table(
  'purchase_order_lines',
  {
    id: id(),
    tenantId: tenantId(),
    purchaseOrderId: uuid('purchase_order_id').notNull(),
    lineNumber: integer('line_number').notNull(),
    productId: uuid('product_id').notNull(),
    orderedLitres: litres('ordered_litres').notNull(),
    agreedUnitPrice: unitPrice('agreed_unit_price'),
    status: text('status').notNull().default('ACTIVE'),
    shortClosedLitres: litres('short_closed_litres'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('purchase_order_lines_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('purchase_order_lines_po_number_uidx').on(
      table.tenantId,
      table.purchaseOrderId,
      table.lineNumber,
    ),
    unique('purchase_order_lines_po_id_product_uidx').on(
      table.tenantId,
      table.purchaseOrderId,
      table.id,
      table.productId,
    ),
    check('purchase_order_lines_litres_ck', sql`${table.orderedLitres} > 0`),
    check(
      'purchase_order_lines_price_ck',
      sql`${table.agreedUnitPrice} is null or ${table.agreedUnitPrice} >= 0`,
    ),
    check('purchase_order_lines_status_ck', sql`${table.status} in ('ACTIVE','REMOVED')`),
    check(
      'purchase_order_lines_short_closed_ck',
      sql`${table.shortClosedLitres} is null or ${table.shortClosedLitres} >= 0`,
    ),
    check('purchase_order_lines_number_ck', sql`${table.lineNumber} >= 1`),
    foreignKey({
      columns: [table.tenantId, table.purchaseOrderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
      name: 'purchase_order_lines_po_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'purchase_order_lines_product_fk',
    }),
  ],
);

/** Append-only snapshots: revision 1 at creation, one more for every amendment. */
export const purchaseOrderRevisions = appSchema.table(
  'purchase_order_revisions',
  {
    id: id(),
    tenantId: tenantId(),
    purchaseOrderId: uuid('purchase_order_id').notNull(),
    revisionNo: integer('revision_no').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    reason: text('reason'),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('purchase_order_revisions_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('purchase_order_revisions_po_revision_uidx').on(
      table.tenantId,
      table.purchaseOrderId,
      table.revisionNo,
    ),
    check('purchase_order_revisions_no_ck', sql`${table.revisionNo} >= 1`),
    foreignKey({
      columns: [table.tenantId, table.purchaseOrderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
      name: 'purchase_order_revisions_po_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'purchase_order_revisions_actor_fk',
    }),
  ],
);

/**
 * Link between a purchase order line and a physical delivery. The delivery is the physical
 * authority: this table only records which order a delivery is received against. Created in a
 * separate table so no A4 table is altered.
 */
export const purchaseOrderDeliveryLinks = appSchema.table(
  'purchase_order_delivery_links',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    purchaseOrderId: uuid('purchase_order_id').notNull(),
    purchaseOrderLineId: uuid('purchase_order_line_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    productId: uuid('product_id').notNull(),
    state: text('state').notNull().default('ACTIVE'),
    linkedBy: uuid('linked_by').notNull(),
    linkedAt: utcTimestamp('linked_at').notNull().defaultNow(),
    unlinkedBy: uuid('unlinked_by'),
    unlinkedAt: utcTimestamp('unlinked_at'),
    unlinkReason: text('unlink_reason'),
  },
  (table) => [
    unique('purchase_order_delivery_links_tenant_id_id_uidx').on(table.tenantId, table.id),
    uniqueIndex('purchase_order_delivery_links_active_delivery_uidx')
      .on(table.tenantId, table.deliveryId)
      .where(sql`${table.state} = 'ACTIVE'`),
    index('purchase_order_delivery_links_po_idx').on(
      table.tenantId,
      table.purchaseOrderId,
      table.state,
    ),
    check('purchase_order_delivery_links_state_ck', sql`${table.state} in ('ACTIVE','UNLINKED')`),
    check(
      'purchase_order_delivery_links_unlink_ck',
      sql`${table.state} <> 'UNLINKED' or (${table.unlinkedBy} is not null and ${table.unlinkedAt} is not null and btrim(coalesce(${table.unlinkReason}, '')) <> '')`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.purchaseOrderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.stationId, purchaseOrders.id],
      name: 'purchase_order_delivery_links_po_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.purchaseOrderId, table.purchaseOrderLineId, table.productId],
      foreignColumns: [
        purchaseOrderLines.tenantId,
        purchaseOrderLines.purchaseOrderId,
        purchaseOrderLines.id,
        purchaseOrderLines.productId,
      ],
      name: 'purchase_order_delivery_links_line_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.deliveryId, table.productId],
      foreignColumns: [
        fuelDeliveries.tenantId,
        fuelDeliveries.stationId,
        fuelDeliveries.id,
        fuelDeliveries.productId,
      ],
      name: 'purchase_order_delivery_links_delivery_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.linkedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'purchase_order_delivery_links_linked_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.unlinkedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'purchase_order_delivery_links_unlinked_by_fk',
    }),
  ],
);
