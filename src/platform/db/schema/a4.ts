import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { memberships, stations, tenants } from './a1';
import { products } from './a3';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });
const litresColumn = (name: string) => numeric(name, { precision: 18, scale: 3 });

export const tanks = appSchema.table(
  'tanks',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    code: text('code').notNull(),
    productId: uuid('product_id').notNull(),
    capacityLitres: litresColumn('capacity_litres').notNull(),
    reorderLevelLitres: litresColumn('reorder_level_litres'),
    /** Yellow: a difference above this must be explained. */
    acceptableVarianceLitres: litresColumn('acceptable_variance_litres'),
    /** Red: a difference above this is urgent. Empty means twice the yellow limit. */
    varianceRedLitres: litresColumn('variance_red_litres'),
    status: text('status').notNull().default('ACTIVE'),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('tanks_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('tanks_tenant_station_id_id_uidx').on(table.tenantId, table.stationId, table.id),
    unique('tanks_tenant_station_code_uidx').on(table.tenantId, table.stationId, table.code),
    unique('tanks_tenant_station_id_product_uidx').on(
      table.tenantId,
      table.stationId,
      table.id,
      table.productId,
    ),
    index('tanks_tenant_station_product_status_idx').on(
      table.tenantId,
      table.stationId,
      table.productId,
      table.status,
    ),
    check('tanks_capacity_positive_chk', sql`${table.capacityLitres} > 0`),
    check(
      'tanks_reorder_nonnegative_chk',
      sql`${table.reorderLevelLitres} is null or ${table.reorderLevelLitres} >= 0`,
    ),
    check(
      'tanks_variance_nonnegative_chk',
      sql`${table.acceptableVarianceLitres} is null or ${table.acceptableVarianceLitres} >= 0`,
    ),
    check('tanks_status_chk', sql`${table.status} in ('ACTIVE', 'INACTIVE', 'RETIRED')`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'tanks_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'tanks_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'tanks_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'tanks_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'tanks_updated_by_fk',
    }),
  ],
);

export const tankCalibrationPoints = appSchema.table(
  'tank_calibration_points',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    tankId: uuid('tank_id').notNull(),
    measurementValue: numeric('measurement_value', { precision: 18, scale: 3 }).notNull(),
    measurementUnit: text('measurement_unit').notNull(),
    litres: litresColumn('litres').notNull(),
    chartVersion: integer('chart_version').notNull().default(1),
    recordedBy: uuid('recorded_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('tank_calibration_points_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('tank_calibration_points_tank_version_measurement_uidx').on(
      table.tenantId,
      table.tankId,
      table.measurementUnit,
      table.chartVersion,
      table.measurementValue,
    ),
    check('tank_calibration_points_chart_version_ck', sql`${table.chartVersion} >= 1`),
    index('tank_calibration_points_tank_idx').on(table.tenantId, table.stationId, table.tankId),
    check(
      'tank_calibration_points_measurement_nonnegative_chk',
      sql`${table.measurementValue} >= 0`,
    ),
    check('tank_calibration_points_litres_nonnegative_chk', sql`${table.litres} >= 0`),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.tankId],
      foreignColumns: [tanks.tenantId, tanks.stationId, tanks.id],
      name: 'tank_calibration_points_tank_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'tank_calibration_points_recorded_by_fk',
    }),
  ],
);

export const tankDips = appSchema.table(
  'tank_dips',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    tankId: uuid('tank_id').notNull(),
    measuredAt: utcTimestamp('measured_at').notNull(),
    businessDate: text('business_date').notNull(),
    physicalLitres: litresColumn('physical_litres').notNull(),
    rawMeasurement: numeric('raw_measurement', { precision: 18, scale: 3 }),
    measurementUnit: text('measurement_unit'),
    recordedBy: uuid('recorded_by').notNull(),
    notes: text('notes'),
    voidedAt: utcTimestamp('voided_at'),
    voidedBy: uuid('voided_by'),
    voidReason: text('void_reason'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('tank_dips_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('tank_dips_tenant_station_id_id_uidx').on(table.tenantId, table.stationId, table.id),
    index('tank_dips_tank_measured_idx').on(
      table.tenantId,
      table.stationId,
      table.tankId,
      table.measuredAt,
    ),
    index('tank_dips_station_business_date_idx').on(
      table.tenantId,
      table.stationId,
      table.businessDate,
    ),
    check('tank_dips_physical_nonnegative_chk', sql`${table.physicalLitres} >= 0`),
    check(
      'tank_dips_raw_measurement_pair_chk',
      sql`(${table.rawMeasurement} is null and ${table.measurementUnit} is null) or (${table.rawMeasurement} is not null and ${table.measurementUnit} is not null)`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.tankId],
      foreignColumns: [tanks.tenantId, tanks.stationId, tanks.id],
      name: 'tank_dips_tank_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'tank_dips_recorded_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.voidedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'tank_dips_voided_by_fk',
    }),
    check(
      'tank_dips_void_fields_ck',
      sql`(${table.voidedAt} is null and ${table.voidedBy} is null and ${table.voidReason} is null) or (${table.voidedAt} is not null and ${table.voidedBy} is not null and ${table.voidReason} is not null and length(trim(${table.voidReason})) >= 5)`,
    ),
  ],
);

export const fuelDeliveries = appSchema.table(
  'fuel_deliveries',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    productId: uuid('product_id').notNull(),
    deliveryNoteNumber: text('delivery_note_number').notNull(),
    deliveredAt: utcTimestamp('delivered_at').notNull(),
    businessDate: text('business_date').notNull(),
    noteQuantityLitres: litresColumn('note_quantity_litres').notNull(),
    actualQuantityLitres: litresColumn('actual_quantity_litres').notNull(),
    shortageExcessLitres: numeric('shortage_excess_litres', { precision: 18, scale: 3 }).notNull(),
    supplierReference: text('supplier_reference'),
    /**
     * Mandatory for new deliveries (CreateDelivery); NULL only on legacy rows ("supplier
     * unassigned"). The composite (tenant_id, supplier_id) FK to app.suppliers lives in
     * migration 0037 because a7 imports this file.
     */
    supplierId: uuid('supplier_id'),
    transporter: text('transporter'),
    driver: text('driver'),
    truckRegistration: text('truck_registration'),
    sealReference: text('seal_reference'),
    preDeliveryDipId: uuid('pre_delivery_dip_id'),
    postDeliveryDipId: uuid('post_delivery_dip_id'),
    status: text('status').notNull().default('DRAFT'),
    /** Why the delivery has no purchase order (migration 0072); NULL when one is linked. */
    noPoReason: text('no_po_reason'),
    noPoNote: text('no_po_note'),
    unitLandedCost: numeric('unit_landed_cost', { precision: 20, scale: 8 }),
    totalLandedCost: numeric('total_landed_cost', { precision: 20, scale: 4 }),
    currency: text('currency'),
    recordedBy: uuid('recorded_by').notNull(),
    confirmedBy: uuid('confirmed_by'),
    confirmedAt: utcTimestamp('confirmed_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('fuel_deliveries_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('fuel_deliveries_tenant_station_id_id_uidx').on(
      table.tenantId,
      table.stationId,
      table.id,
    ),
    unique('fuel_deliveries_station_note_uidx').on(
      table.tenantId,
      table.stationId,
      table.deliveryNoteNumber,
    ),
    unique('fuel_deliveries_tenant_station_id_product_uidx').on(
      table.tenantId,
      table.stationId,
      table.id,
      table.productId,
    ),
    index('fuel_deliveries_station_business_date_idx').on(
      table.tenantId,
      table.stationId,
      table.businessDate,
    ),
    check('fuel_deliveries_note_quantity_nonnegative_chk', sql`${table.noteQuantityLitres} >= 0`),
    check(
      'fuel_deliveries_actual_quantity_nonnegative_chk',
      sql`${table.actualQuantityLitres} >= 0`,
    ),
    check(
      'fuel_deliveries_shortage_excess_consistent_chk',
      sql`${table.shortageExcessLitres} = ${table.actualQuantityLitres} - ${table.noteQuantityLitres}`,
    ),
    check(
      'fuel_deliveries_status_chk',
      sql`${table.status} in ('DRAFT', 'CONFIRMED', 'CANCELLED')`,
    ),
    check(
      'fuel_deliveries_cost_pair_chk',
      sql`(${table.unitLandedCost} is null and ${table.totalLandedCost} is null and ${table.currency} is null) or (${table.unitLandedCost} is not null and ${table.totalLandedCost} is not null and ${table.currency} is not null)`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'fuel_deliveries_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'fuel_deliveries_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.preDeliveryDipId],
      foreignColumns: [tankDips.tenantId, tankDips.stationId, tankDips.id],
      name: 'fuel_deliveries_pre_dip_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.postDeliveryDipId],
      foreignColumns: [tankDips.tenantId, tankDips.stationId, tankDips.id],
      name: 'fuel_deliveries_post_dip_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'fuel_deliveries_recorded_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.confirmedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'fuel_deliveries_confirmed_by_fk',
    }),
  ],
);

export const fuelDeliveryAllocations = appSchema.table(
  'fuel_delivery_allocations',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    tankId: uuid('tank_id').notNull(),
    productId: uuid('product_id').notNull(),
    quantityLitres: litresColumn('quantity_litres').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('fuel_delivery_allocations_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('fuel_delivery_allocations_delivery_tank_uidx').on(
      table.tenantId,
      table.deliveryId,
      table.tankId,
    ),
    index('fuel_delivery_allocations_tank_idx').on(table.tenantId, table.stationId, table.tankId),
    check('fuel_delivery_allocations_quantity_positive_chk', sql`${table.quantityLitres} > 0`),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.deliveryId],
      foreignColumns: [fuelDeliveries.tenantId, fuelDeliveries.stationId, fuelDeliveries.id],
      name: 'fuel_delivery_allocations_delivery_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.tankId, table.productId],
      foreignColumns: [tanks.tenantId, tanks.stationId, tanks.id, tanks.productId],
      name: 'fuel_delivery_allocations_tank_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.deliveryId, table.productId],
      foreignColumns: [
        fuelDeliveries.tenantId,
        fuelDeliveries.stationId,
        fuelDeliveries.id,
        fuelDeliveries.productId,
      ],
      name: 'fuel_delivery_allocations_delivery_product_fk',
    }),
  ],
);

export const inventoryMovements = appSchema.table(
  'inventory_movements',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    tankId: uuid('tank_id').notNull(),
    productId: uuid('product_id').notNull(),
    movementType: text('movement_type').notNull(),
    quantityLitres: numeric('quantity_litres', { precision: 18, scale: 3 }).notNull(),
    effectiveAt: utcTimestamp('effective_at').notNull(),
    businessDate: text('business_date').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    reason: text('reason'),
    unitLandedCost: numeric('unit_landed_cost', { precision: 20, scale: 8 }),
    totalLandedCost: numeric('total_landed_cost', { precision: 20, scale: 4 }),
    currency: text('currency'),
    postedAt: utcTimestamp('posted_at').notNull().defaultNow(),
  },
  (table) => [
    unique('inventory_movements_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('inventory_movements_source_uidx').on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
      table.movementType,
    ),
    index('inventory_movements_tank_effective_idx').on(
      table.tenantId,
      table.stationId,
      table.tankId,
      table.effectiveAt,
    ),
    index('inventory_movements_station_business_date_idx').on(
      table.tenantId,
      table.stationId,
      table.businessDate,
    ),
    check('inventory_movements_nonzero_quantity_chk', sql`${table.quantityLitres} <> 0`),
    check(
      'inventory_movements_cost_pair_chk',
      sql`(${table.unitLandedCost} is null and ${table.totalLandedCost} is null and ${table.currency} is null) or (${table.unitLandedCost} is not null and ${table.totalLandedCost} is not null and ${table.currency} is not null)`,
    ),
    check(
      'inventory_movements_reason_for_adjustment_chk',
      sql`${table.movementType} not in ('POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT') or btrim(coalesce(${table.reason}, '')) <> ''`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.tankId, table.productId],
      foreignColumns: [tanks.tenantId, tanks.stationId, tanks.id, tanks.productId],
      name: 'inventory_movements_tank_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'inventory_movements_actor_fk',
    }),
  ],
);
