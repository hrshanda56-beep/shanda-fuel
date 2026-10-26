import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { legalEntities, memberships } from './a1';
import { products } from './a3';
import { fuelDeliveries } from './a4';
import { supplierDocumentDeliveryRefs, supplierDocuments, suppliers } from './a7';

/**
 * ADR-018 supplier side (migration 0037): invoice lines, the customizable purchasing policy
 * and the append-only delivery supplier correction record. RLS, grants and guard triggers are
 * hand-authored in the migration.
 */
const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });
const moneyColumn = (name: string) => numeric(name, { precision: 20, scale: 4 });
const percentColumn = (name: string) => numeric(name, { precision: 9, scale: 4 });

export const supplierDocumentLines = appSchema.table(
  'supplier_document_lines',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    supplierDocumentId: uuid('supplier_document_id').notNull(),
    lineNo: integer('line_no').notNull(),
    productId: uuid('product_id'),
    /** FUEL, TRANSPORT or OTHER_DIRECT_COST; null = entered before types (migration 0075). */
    lineType: text('line_type'),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 18, scale: 3 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 20, scale: 8 }).notNull(),
    netAmount: moneyColumn('net_amount').notNull(),
    vatRate: percentColumn('vat_rate'),
    vatAmount: moneyColumn('vat_amount').notNull().default('0'),
    grossAmount: moneyColumn('gross_amount').notNull(),
    deliveryRefId: uuid('delivery_ref_id'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('supplier_document_lines_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('supplier_document_lines_document_line_uidx').on(
      table.tenantId,
      table.supplierDocumentId,
      table.lineNo,
    ),
    index('supplier_document_lines_document_idx').on(table.tenantId, table.supplierDocumentId),
    check('supplier_document_lines_line_no_ck', sql`${table.lineNo} > 0`),
    check(
      'supplier_document_lines_line_type_ck',
      sql`${table.lineType} is null or ${table.lineType} in ('FUEL','TRANSPORT','OTHER_DIRECT_COST')`,
    ),
    check(
      'supplier_document_lines_line_type_product_ck',
      sql`${table.lineType} is null or ${table.lineType} = 'FUEL' or ${table.productId} is null`,
    ),
    check('supplier_document_lines_description_ck', sql`btrim(${table.description}) <> ''`),
    check('supplier_document_lines_quantity_ck', sql`${table.quantity} > 0`),
    check('supplier_document_lines_unit_price_ck', sql`${table.unitPrice} >= 0`),
    check(
      'supplier_document_lines_amounts_ck',
      sql`${table.netAmount} >= 0 and ${table.vatAmount} >= 0 and ${table.grossAmount} = ${table.netAmount} + ${table.vatAmount}`,
    ),
    check(
      'supplier_document_lines_vat_rate_ck',
      sql`${table.vatRate} is null or (${table.vatRate} >= 0 and ${table.vatRate} <= 100)`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'supplier_document_lines_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.supplierDocumentId],
      foreignColumns: [supplierDocuments.tenantId, supplierDocuments.id],
      name: 'supplier_document_lines_document_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'supplier_document_lines_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.deliveryRefId],
      foreignColumns: [supplierDocumentDeliveryRefs.tenantId, supplierDocumentDeliveryRefs.id],
      name: 'supplier_document_lines_delivery_ref_fk',
    }),
  ],
);

/**
 * One tenant-level row (supplier_id null) plus optional per-supplier overrides. Override
 * rows inherit every NULL field from the tenant row; tenant-level rows always carry the
 * action, VAT mode and invoice-line rule. Tolerances left NULL mean zero tolerance.
 */
export const purchasingPolicies = appSchema.table(
  'purchasing_policies',
  {
    id: id(),
    tenantId: tenantId(),
    supplierId: uuid('supplier_id'),
    quantityToleranceLitres: numeric('quantity_tolerance_litres', { precision: 18, scale: 3 }),
    quantityTolerancePercent: percentColumn('quantity_tolerance_percent'),
    priceTolerancePercent: percentColumn('price_tolerance_percent'),
    amountTolerance: moneyColumn('amount_tolerance'),
    overReceiptToleranceLitres: numeric('over_receipt_tolerance_litres', {
      precision: 18,
      scale: 3,
    }),
    overReceiptTolerancePercent: percentColumn('over_receipt_tolerance_percent'),
    toleranceAction: text('tolerance_action'),
    vatMode: text('vat_mode'),
    defaultVatRate: percentColumn('default_vat_rate'),
    productVatRates: jsonb('product_vat_rates')
      .notNull()
      .default(sql`'{}'::jsonb`),
    requireInvoiceLines: boolean('require_invoice_lines'),
    version: integer('version').notNull().default(0),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('purchasing_policies_tenant_id_id_uidx').on(table.tenantId, table.id),
    uniqueIndex('purchasing_policies_tenant_uidx')
      .on(table.tenantId)
      .where(sql`${table.supplierId} is null`),
    uniqueIndex('purchasing_policies_supplier_uidx')
      .on(table.tenantId, table.supplierId)
      .where(sql`${table.supplierId} is not null`),
    check(
      'purchasing_policies_action_ck',
      sql`${table.toleranceAction} is null or ${table.toleranceAction} in ('FLAG','REQUIRE_APPROVAL')`,
    ),
    check(
      'purchasing_policies_vat_mode_ck',
      sql`${table.vatMode} is null or ${table.vatMode} in ('NONE','EXCLUSIVE','INCLUSIVE')`,
    ),
    check(
      'purchasing_policies_tenant_level_ck',
      sql`${table.supplierId} is not null or (${table.toleranceAction} is not null and ${table.vatMode} is not null and ${table.requireInvoiceLines} is not null)`,
    ),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'purchasing_policies_supplier_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'purchasing_policies_updated_by_fk',
    }),
  ],
);

export const purchasingPolicyRevisions = appSchema.table(
  'purchasing_policy_revisions',
  {
    id: id(),
    tenantId: tenantId(),
    policyId: uuid('policy_id').notNull(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    reason: text('reason'),
    changedBy: uuid('changed_by').notNull(),
    changedAt: utcTimestamp('changed_at').notNull().defaultNow(),
  },
  (table) => [
    unique('purchasing_policy_revisions_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('purchasing_policy_revisions_version_uidx').on(
      table.tenantId,
      table.policyId,
      table.version,
    ),
    foreignKey({
      columns: [table.tenantId, table.policyId],
      foreignColumns: [purchasingPolicies.tenantId, purchasingPolicies.id],
      name: 'purchasing_policy_revisions_policy_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.changedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'purchasing_policy_revisions_changed_by_fk',
    }),
  ],
);

export const deliverySupplierCorrections = appSchema.table(
  'delivery_supplier_corrections',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    previousSupplierId: uuid('previous_supplier_id'),
    supplierId: uuid('supplier_id').notNull(),
    reason: text('reason').notNull(),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    correctedAt: utcTimestamp('corrected_at').notNull().defaultNow(),
  },
  (table) => [
    unique('delivery_supplier_corrections_tenant_id_id_uidx').on(table.tenantId, table.id),
    index('delivery_supplier_corrections_delivery_idx').on(
      table.tenantId,
      table.stationId,
      table.deliveryId,
    ),
    check('delivery_supplier_corrections_reason_ck', sql`btrim(${table.reason}) <> ''`),
    check(
      'delivery_supplier_corrections_change_ck',
      sql`${table.previousSupplierId} is distinct from ${table.supplierId}`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.deliveryId],
      foreignColumns: [fuelDeliveries.tenantId, fuelDeliveries.stationId, fuelDeliveries.id],
      name: 'delivery_supplier_corrections_delivery_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.previousSupplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'delivery_supplier_corrections_previous_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'delivery_supplier_corrections_supplier_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'delivery_supplier_corrections_actor_fk',
    }),
  ],
);
