import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  check,
  foreignKey,
  index,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { memberships } from './a1';
import {
  meterSegments,
  nozzles,
  products,
  reconciliationRevisions,
  reconciliations,
  sellingPrices,
  shifts,
} from './a3';
import { customerAccounts } from './a8';
import { fuelDeliveries, tankDips, tanks } from './a4';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });

const reconciliationScope = (
  table: { tenantId: AnyPgColumn; stationId: AnyPgColumn; reconciliationId: AnyPgColumn },
  name: string,
) =>
  foreignKey({
    columns: [table.tenantId, table.stationId, table.reconciliationId],
    foreignColumns: [reconciliations.tenantId, reconciliations.stationId, reconciliations.id],
    name,
  });

export const reconciliationAttendants = appSchema.table(
  'reconciliation_attendants',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    reconciliationId: uuid('reconciliation_id').notNull(),
    attendantId: uuid('attendant_id').notNull(),
    assignedBy: uuid('assigned_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliation_attendants_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('reconciliation_attendants_member_uidx').on(
      table.tenantId,
      table.stationId,
      table.reconciliationId,
      table.attendantId,
    ),
    reconciliationScope(table, 'reconciliation_attendants_reconciliation_fk'),
    foreignKey({
      columns: [table.tenantId, table.attendantId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_attendants_attendant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.assignedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_attendants_assigned_by_fk',
    }),
  ],
);

export const reconciliationMeterReadings = appSchema.table(
  'reconciliation_meter_readings',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    reconciliationId: uuid('reconciliation_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    nozzleId: uuid('nozzle_id').notNull(),
    productId: uuid('product_id').notNull(),
    openingReading: numeric('opening_reading', { precision: 18, scale: 3 }).notNull(),
    closingReading: numeric('closing_reading', { precision: 18, scale: 3 }).notNull(),
    litresSold: numeric('litres_sold', { precision: 18, scale: 3 }).notNull(),
    sellingPriceId: uuid('selling_price_id'),
    unitPrice: numeric('unit_price', { precision: 20, scale: 6 }).notNull(),
    salesValue: numeric('sales_value', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    enteredBy: uuid('entered_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliation_meter_readings_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('reconciliation_meter_readings_tenant_station_id_uidx').on(
      table.tenantId,
      table.stationId,
      table.id,
    ),
    unique('reconciliation_meter_readings_reconciliation_id_uidx').on(
      table.tenantId,
      table.stationId,
      table.reconciliationId,
      table.id,
    ),
    unique('reconciliation_meter_readings_nozzle_uidx').on(
      table.tenantId,
      table.stationId,
      table.reconciliationId,
      table.nozzleId,
    ),
    check('reconciliation_meter_readings_nonnegative_litres_ck', sql`${table.litresSold} >= 0`),
    check(
      'reconciliation_meter_readings_arithmetic_ck',
      sql`${table.litresSold} = ${table.closingReading} - ${table.openingReading}`,
    ),
    check(
      'reconciliation_meter_readings_sales_value_ck',
      sql`${table.salesValue} = round(${table.litresSold} * ${table.unitPrice}, 4)`,
    ),
    check('reconciliation_meter_readings_currency_ck', sql`${table.currency} = 'USD'`),
    reconciliationScope(table, 'reconciliation_meter_readings_reconciliation_fk'),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.shiftId],
      foreignColumns: [shifts.tenantId, shifts.stationId, shifts.id],
      name: 'reconciliation_meter_readings_shift_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.nozzleId],
      foreignColumns: [nozzles.tenantId, nozzles.stationId, nozzles.id],
      name: 'reconciliation_meter_readings_nozzle_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'reconciliation_meter_readings_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.sellingPriceId],
      foreignColumns: [sellingPrices.tenantId, sellingPrices.stationId, sellingPrices.id],
      name: 'reconciliation_meter_readings_price_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.enteredBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_meter_readings_entered_by_fk',
    }),
  ],
);

/**
 * Immutable A5-to-A3 lineage for canonical segment-level sale posting.
 *
 * The production migration adds a dedicated context/lifecycle guard because
 * rows are inserted while the parent reconciliation is SUBMITTED or
 * PENDING_APPROVAL and the linked revision is PENDING_APPROVAL. The bridge is
 * append-only and is never rewritten after approval, posting, or locking.
 */
export const reconciliationMeterReadingSegments = appSchema.table(
  'reconciliation_meter_reading_segments',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    reconciliationId: uuid('reconciliation_id').notNull(),
    revisionId: uuid('revision_id').notNull(),
    reconciliationMeterReadingId: uuid('reconciliation_meter_reading_id').notNull(),
    meterSegmentId: uuid('meter_segment_id').notNull(),
    allocatedLitres: numeric('allocated_litres', { precision: 18, scale: 3 }).notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliation_meter_reading_segments_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('reconciliation_meter_reading_segments_reading_segment_uidx').on(
      table.tenantId,
      table.stationId,
      table.reconciliationMeterReadingId,
      table.meterSegmentId,
    ),
    unique('reconciliation_meter_reading_segments_segment_uidx').on(
      table.tenantId,
      table.stationId,
      table.meterSegmentId,
    ),
    index('reconciliation_meter_reading_segments_reading_idx').on(
      table.tenantId,
      table.stationId,
      table.reconciliationId,
      table.revisionId,
      table.reconciliationMeterReadingId,
    ),
    check(
      'reconciliation_meter_reading_segments_nonnegative_litres_ck',
      sql`${table.allocatedLitres} >= 0`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.reconciliationId],
      foreignColumns: [reconciliations.tenantId, reconciliations.stationId, reconciliations.id],
      name: 'reconciliation_meter_reading_segments_reconciliation_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.reconciliationId, table.revisionId],
      foreignColumns: [
        reconciliationRevisions.tenantId,
        reconciliationRevisions.stationId,
        reconciliationRevisions.reconciliationId,
        reconciliationRevisions.id,
      ],
      name: 'reconciliation_meter_reading_segments_revision_fk',
    }),
    foreignKey({
      columns: [
        table.tenantId,
        table.stationId,
        table.reconciliationId,
        table.reconciliationMeterReadingId,
      ],
      foreignColumns: [
        reconciliationMeterReadings.tenantId,
        reconciliationMeterReadings.stationId,
        reconciliationMeterReadings.reconciliationId,
        reconciliationMeterReadings.id,
      ],
      name: 'reconciliation_meter_reading_segments_reading_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.meterSegmentId],
      foreignColumns: [meterSegments.tenantId, meterSegments.stationId, meterSegments.id],
      name: 'reconciliation_meter_reading_segments_meter_segment_fk',
    }),
  ],
);

export const reconciliationPayments = appSchema.table(
  'reconciliation_payments',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    reconciliationId: uuid('reconciliation_id').notNull(),
    method: text('method').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    reference: text('reference'),
    note: text('note'),
    /** The customer account a credit or prepaid sale is charged to (DEC-044). */
    customerAccountId: uuid('customer_account_id'),
    /** Who received approved (staff or management) fuel (DEC-044). */
    beneficiaryName: text('beneficiary_name'),
    enteredBy: uuid('entered_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliation_payments_tenant_id_id_uidx').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId],
      foreignColumns: [customerAccounts.tenantId, customerAccounts.id],
      name: 'reconciliation_payments_customer_account_fk',
    }),
    check('reconciliation_payments_amount_ck', sql`${table.amount} >= 0`),
    check(
      'reconciliation_payments_method_ck',
      sql`${table.method} in ('CASH','POS','ECOCASH','BANK_TRANSFER','CUSTOMER_CREDIT','PREPAID','STAFF_OR_MANAGEMENT_FUEL','OTHER_APPROVED')`,
    ),
    reconciliationScope(table, 'reconciliation_payments_reconciliation_fk'),
    foreignKey({
      columns: [table.tenantId, table.enteredBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_payments_entered_by_fk',
    }),
  ],
);

export const reconciliationExpenses = appSchema.table(
  'reconciliation_expenses',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    reconciliationId: uuid('reconciliation_id').notNull(),
    category: text('category').notNull(),
    description: text('description').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    paymentMethod: text('payment_method').notNull(),
    personPaid: text('person_paid'),
    reference: text('reference'),
    enteredBy: uuid('entered_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliation_expenses_tenant_id_id_uidx').on(table.tenantId, table.id),
    check('reconciliation_expenses_amount_ck', sql`${table.amount} >= 0`),
    reconciliationScope(table, 'reconciliation_expenses_reconciliation_fk'),
    foreignKey({
      columns: [table.tenantId, table.enteredBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_expenses_entered_by_fk',
    }),
  ],
);

export const reconciliationDeliveryRefs = appSchema.table(
  'reconciliation_delivery_refs',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    reconciliationId: uuid('reconciliation_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    allocationId: uuid('allocation_id'),
    productId: uuid('product_id').notNull(),
    tankId: uuid('tank_id').notNull(),
    enteredBy: uuid('entered_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliation_delivery_refs_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('reconciliation_delivery_refs_delivery_uidx').on(
      table.tenantId,
      table.stationId,
      table.reconciliationId,
      table.deliveryId,
      table.allocationId,
    ),
    reconciliationScope(table, 'reconciliation_delivery_refs_reconciliation_fk'),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.deliveryId],
      foreignColumns: [fuelDeliveries.tenantId, fuelDeliveries.stationId, fuelDeliveries.id],
      name: 'reconciliation_delivery_refs_delivery_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.tankId],
      foreignColumns: [tanks.tenantId, tanks.stationId, tanks.id],
      name: 'reconciliation_delivery_refs_tank_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'reconciliation_delivery_refs_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.enteredBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_delivery_refs_entered_by_fk',
    }),
  ],
);

export const reconciliationDipRefs = appSchema.table(
  'reconciliation_dip_refs',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    reconciliationId: uuid('reconciliation_id').notNull(),
    dipId: uuid('dip_id').notNull(),
    tankId: uuid('tank_id').notNull(),
    productId: uuid('product_id').notNull(),
    enteredBy: uuid('entered_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliation_dip_refs_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('reconciliation_dip_refs_dip_uidx').on(
      table.tenantId,
      table.stationId,
      table.reconciliationId,
      table.dipId,
    ),
    reconciliationScope(table, 'reconciliation_dip_refs_reconciliation_fk'),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.dipId],
      foreignColumns: [tankDips.tenantId, tankDips.stationId, tankDips.id],
      name: 'reconciliation_dip_refs_dip_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.tankId],
      foreignColumns: [tanks.tenantId, tanks.stationId, tanks.id],
      name: 'reconciliation_dip_refs_tank_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'reconciliation_dip_refs_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.enteredBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_dip_refs_entered_by_fk',
    }),
  ],
);

export const reconciliationCashDeclarations = appSchema.table(
  'reconciliation_cash_declarations',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    reconciliationId: uuid('reconciliation_id').notNull(),
    countedCash: numeric('counted_cash', { precision: 20, scale: 4 }).notNull(),
    expectedPhysicalCash: numeric('expected_physical_cash', { precision: 20, scale: 4 }).notNull(),
    cashPaidExpenses: numeric('cash_paid_expenses', { precision: 20, scale: 4 }).notNull(),
    netExpectedCash: numeric('net_expected_cash', { precision: 20, scale: 4 }).notNull(),
    cashVariance: numeric('cash_variance', { precision: 20, scale: 4 }).notNull(),
    explanation: text('explanation'),
    enteredBy: uuid('entered_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliation_cash_declarations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('reconciliation_cash_declarations_reconciliation_uidx').on(
      table.tenantId,
      table.stationId,
      table.reconciliationId,
    ),
    check('reconciliation_cash_declarations_nonnegative_ck', sql`${table.countedCash} >= 0`),
    reconciliationScope(table, 'reconciliation_cash_declarations_reconciliation_fk'),
    foreignKey({
      columns: [table.tenantId, table.enteredBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_cash_declarations_entered_by_fk',
    }),
  ],
);

export const reconciliationVarianceExplanations = appSchema.table(
  'reconciliation_variance_explanations',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    reconciliationId: uuid('reconciliation_id').notNull(),
    category: text('category').notNull(),
    explanation: text('explanation').notNull(),
    enteredBy: uuid('entered_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('reconciliation_variance_explanations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('reconciliation_variance_explanations_category_uidx').on(
      table.tenantId,
      table.stationId,
      table.reconciliationId,
      table.category,
    ),
    check(
      'reconciliation_variance_explanations_category_ck',
      sql`${table.category} in ('SALES','CASH','STOCK')`,
    ),
    reconciliationScope(table, 'reconciliation_variance_explanations_reconciliation_fk'),
    foreignKey({
      columns: [table.tenantId, table.enteredBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'reconciliation_variance_explanations_entered_by_fk',
    }),
  ],
);
