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
import { legalEntities, memberships, stations, tenants } from './a1';
import { fuelDeliveryAllocations, fuelDeliveries } from './a4';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });
const moneyColumn = (name: string) => numeric(name, { precision: 20, scale: 4 });

export const suppliers = appSchema.table(
  'suppliers',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    legalName: text('legal_name').notNull(),
    registrationReference: text('registration_reference'),
    status: text('status').notNull().default('ACTIVE'),
    creditLimit: numeric('credit_limit', { precision: 20, scale: 4 }),
    version: integer('version').notNull().default(0),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('suppliers_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('suppliers_tenant_code_uidx').on(table.tenantId, table.code),
    index('suppliers_tenant_status_idx').on(table.tenantId, table.status),
    check('suppliers_code_nonempty_ck', sql`btrim(${table.code}) <> ''`),
    check('suppliers_legal_name_nonempty_ck', sql`btrim(${table.legalName}) <> ''`),
    check('suppliers_status_ck', sql`${table.status} in ('ACTIVE','INACTIVE')`),
    check(
      'suppliers_credit_limit_ck',
      sql`${table.creditLimit} is null or ${table.creditLimit} >= 0`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'suppliers_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'suppliers_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'suppliers_updated_by_fk',
    }),
  ],
);

export const supplierDocuments = appSchema.table(
  'supplier_documents',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    documentType: text('document_type').notNull(),
    referenceNumber: text('reference_number').notNull(),
    documentDate: text('document_date').notNull(),
    dueDate: text('due_date'),
    currency: text('currency').notNull().default('USD'),
    amount: moneyColumn('amount').notNull(),
    state: text('state').notNull().default('DRAFT'),
    version: integer('version').notNull().default(0),
    createdBy: uuid('created_by').notNull(),
    submittedBy: uuid('submitted_by'),
    submittedAt: utcTimestamp('submitted_at'),
    postedBy: uuid('posted_by'),
    postedAt: utcTimestamp('posted_at'),
    reversedBy: uuid('reversed_by'),
    reversedAt: utcTimestamp('reversed_at'),
    reversalReason: text('reversal_reason'),
    /** NULL net/vat/mode marks a legacy header-only document (migration 0037). */
    netAmount: moneyColumn('net_amount'),
    vatAmount: moneyColumn('vat_amount'),
    vatMode: text('vat_mode'),
    varianceStatus: text('variance_status').notNull().default('NOT_EVALUATED'),
    varianceSnapshot: jsonb('variance_snapshot'),
    varianceApprovalReason: text('variance_approval_reason'),
    varianceApprovedBy: uuid('variance_approved_by'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('supplier_documents_tenant_id_id_uidx').on(table.tenantId, table.id),
    // Duplicate control for non-reversed documents only (migration 0038): a corrected invoice
    // may reuse the reference of one that was reversed.
    uniqueIndex('supplier_documents_tenant_supplier_reference_uidx')
      .on(table.tenantId, table.supplierId, table.referenceNumber)
      .where(sql`${table.state} <> 'REVERSED'`),
    index('supplier_documents_tenant_supplier_state_idx').on(
      table.tenantId,
      table.supplierId,
      table.state,
    ),
    index('supplier_documents_tenant_due_date_idx').on(table.tenantId, table.dueDate, table.state),
    check('supplier_documents_type_ck', sql`${table.documentType} in ('INVOICE','CREDIT_NOTE')`),
    check('supplier_documents_reference_nonempty_ck', sql`btrim(${table.referenceNumber}) <> ''`),
    check('supplier_documents_currency_ck', sql`${table.currency} = 'USD'`),
    check('supplier_documents_amount_positive_ck', sql`${table.amount} > 0`),
    check(
      'supplier_documents_state_ck',
      sql`${table.state} in ('DRAFT','SUBMITTED','POSTED','PARTIALLY_PAID','PAID','REVERSED')`,
    ),
    check(
      'supplier_documents_due_date_order_ck',
      sql`${table.dueDate} is null or ${table.dueDate} >= ${table.documentDate}`,
    ),
    check(
      'supplier_documents_post_provenance_ck',
      sql`${table.postedAt} is null or ${table.postedBy} is not null`,
    ),
    check(
      'supplier_documents_reversal_provenance_ck',
      sql`${table.state} <> 'REVERSED' or (${table.reversedBy} is not null and ${table.reversedAt} is not null and btrim(coalesce(${table.reversalReason}, '')) <> '')`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'supplier_documents_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'supplier_documents_supplier_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'supplier_documents_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.submittedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'supplier_documents_submitted_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.postedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'supplier_documents_posted_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reversedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'supplier_documents_reversed_by_fk',
    }),
  ],
);

export const supplierDocumentDeliveryRefs = appSchema.table(
  'supplier_document_delivery_refs',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    supplierDocumentId: uuid('supplier_document_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    allocationId: uuid('allocation_id'),
    linkedBy: uuid('linked_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    /** Coverage facts (migration 0037): see ADR-018 D2. Only active/released_at ever change. */
    documentType: text('document_type').notNull(),
    invoicedQuantityLitres: numeric('invoiced_quantity_litres', { precision: 18, scale: 3 }),
    invoicedAmount: moneyColumn('invoiced_amount'),
    active: boolean('active').notNull().default(false),
    releasedAt: utcTimestamp('released_at'),
    needsFinanceReview: boolean('needs_finance_review').notNull().default(false),
  },
  (table) => [
    unique('supplier_document_delivery_refs_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('supplier_document_delivery_refs_document_source_uidx').on(
      table.tenantId,
      table.supplierDocumentId,
      table.deliveryId,
      table.allocationId,
    ),
    index('supplier_document_delivery_refs_delivery_idx').on(
      table.tenantId,
      table.stationId,
      table.deliveryId,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'supplier_document_delivery_refs_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.supplierDocumentId],
      foreignColumns: [supplierDocuments.tenantId, supplierDocuments.id],
      name: 'supplier_document_delivery_refs_document_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.deliveryId],
      foreignColumns: [fuelDeliveries.tenantId, fuelDeliveries.stationId, fuelDeliveries.id],
      name: 'supplier_document_delivery_refs_delivery_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.allocationId],
      foreignColumns: [fuelDeliveryAllocations.tenantId, fuelDeliveryAllocations.id],
      name: 'supplier_document_delivery_refs_allocation_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.linkedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'supplier_document_delivery_refs_linked_by_fk',
    }),
  ],
);

export const supplierPayments = appSchema.table(
  'supplier_payments',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    paymentDate: text('payment_date').notNull(),
    paymentReference: text('payment_reference').notNull(),
    paymentMethod: text('payment_method'),
    externalReference: text('external_reference'),
    currency: text('currency').notNull().default('USD'),
    amount: moneyColumn('amount').notNull(),
    state: text('state').notNull().default('DRAFT'),
    version: integer('version').notNull().default(0),
    createdBy: uuid('created_by').notNull(),
    submittedBy: uuid('submitted_by'),
    submittedAt: utcTimestamp('submitted_at'),
    postedBy: uuid('posted_by'),
    postedAt: utcTimestamp('posted_at'),
    reversedBy: uuid('reversed_by'),
    reversedAt: utcTimestamp('reversed_at'),
    reversalReason: text('reversal_reason'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('supplier_payments_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('supplier_payments_tenant_supplier_reference_uidx').on(
      table.tenantId,
      table.supplierId,
      table.paymentReference,
    ),
    index('supplier_payments_tenant_supplier_state_idx').on(
      table.tenantId,
      table.supplierId,
      table.state,
    ),
    check('supplier_payments_reference_nonempty_ck', sql`btrim(${table.paymentReference}) <> ''`),
    check('supplier_payments_currency_ck', sql`${table.currency} = 'USD'`),
    check('supplier_payments_amount_positive_ck', sql`${table.amount} > 0`),
    check(
      'supplier_payments_state_ck',
      sql`${table.state} in ('DRAFT','SUBMITTED','POSTED','REVERSED')`,
    ),
    check(
      'supplier_payments_post_provenance_ck',
      sql`${table.postedAt} is null or ${table.postedBy} is not null`,
    ),
    check(
      'supplier_payments_reversal_provenance_ck',
      sql`${table.state} <> 'REVERSED' or (${table.reversedBy} is not null and ${table.reversedAt} is not null and btrim(coalesce(${table.reversalReason}, '')) <> '')`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'supplier_payments_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'supplier_payments_supplier_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'supplier_payments_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.submittedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'supplier_payments_submitted_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.postedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'supplier_payments_posted_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reversedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'supplier_payments_reversed_by_fk',
    }),
  ],
);

export const supplierPaymentAllocations = appSchema.table(
  'supplier_payment_allocations',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    paymentId: uuid('payment_id').notNull(),
    documentId: uuid('document_id').notNull(),
    amount: moneyColumn('amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    state: text('state').notNull().default('POSTED'),
    reversalOfId: uuid('reversal_of_id'),
    allocatedBy: uuid('allocated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('supplier_payment_allocations_tenant_id_id_uidx').on(table.tenantId, table.id),
    index('supplier_payment_allocations_payment_idx').on(
      table.tenantId,
      table.paymentId,
      table.state,
    ),
    index('supplier_payment_allocations_document_idx').on(
      table.tenantId,
      table.documentId,
      table.state,
    ),
    check('supplier_payment_allocations_amount_positive_ck', sql`${table.amount} > 0`),
    check('supplier_payment_allocations_currency_ck', sql`${table.currency} = 'USD'`),
    check('supplier_payment_allocations_state_ck', sql`${table.state} in ('POSTED','REVERSED')`),
    check(
      'supplier_payment_allocations_reversal_ck',
      sql`${table.state} <> 'REVERSED' or ${table.reversalOfId} is not null`,
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'supplier_payment_allocations_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'supplier_payment_allocations_supplier_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.paymentId],
      foreignColumns: [supplierPayments.tenantId, supplierPayments.id],
      name: 'supplier_payment_allocations_payment_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [supplierDocuments.tenantId, supplierDocuments.id],
      name: 'supplier_payment_allocations_document_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reversalOfId],
      foreignColumns: [table.tenantId, table.id],
      name: 'supplier_payment_allocations_reversal_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.allocatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'supplier_payment_allocations_allocated_by_fk',
    }),
  ],
);

export const supplierAccountMovements = appSchema.table(
  'supplier_account_movements',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    movementType: text('movement_type').notNull(),
    amount: moneyColumn('amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    effectiveDate: text('effective_date').notNull(),
    reversalOfId: uuid('reversal_of_id'),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    postedAt: utcTimestamp('posted_at').notNull().defaultNow(),
  },
  (table) => [
    unique('supplier_account_movements_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('supplier_account_movements_source_uidx').on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
      table.movementType,
    ),
    index('supplier_account_movements_supplier_posted_idx').on(
      table.tenantId,
      table.supplierId,
      table.postedAt,
    ),
    index('supplier_account_movements_supplier_effective_idx').on(
      table.tenantId,
      table.supplierId,
      table.effectiveDate,
    ),
    check(
      'supplier_account_movements_type_ck',
      sql`${table.movementType} in ('INVOICE','CREDIT_NOTE','PAYMENT','PAYMENT_REVERSAL','ADJUSTMENT')`,
    ),
    check('supplier_account_movements_amount_positive_ck', sql`${table.amount} > 0`),
    check('supplier_account_movements_currency_ck', sql`${table.currency} = 'USD'`),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'supplier_account_movements_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'supplier_account_movements_supplier_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.reversalOfId],
      foreignColumns: [table.tenantId, table.id],
      name: 'supplier_account_movements_reversal_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'supplier_account_movements_actor_fk',
    }),
  ],
);
