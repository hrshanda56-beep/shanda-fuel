import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { memberships, tenants } from './a1';
import { products } from './a3';
import { fuelDeliveries } from './a4';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });
const litresColumn = (name: string) => numeric(name, { precision: 18, scale: 3 });

/** One truck compartment of one delivery (migration 0065). */
export const fuelDeliveryCompartments = appSchema.table(
  'fuel_delivery_compartments',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    stationId: uuid('station_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    compartmentNumber: integer('compartment_number').notNull(),
    productId: uuid('product_id').notNull(),
    noteLitres: litresColumn('note_litres').notNull(),
    receivedLitres: litresColumn('received_litres').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('fuel_delivery_compartments_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('fuel_delivery_compartments_delivery_number_uidx').on(
      table.tenantId,
      table.deliveryId,
      table.compartmentNumber,
    ),
    index('fuel_delivery_compartments_delivery_idx').on(table.tenantId, table.deliveryId),
    check(
      'fuel_delivery_compartments_number_chk',
      sql`${table.compartmentNumber} between 1 and 30`,
    ),
    check('fuel_delivery_compartments_note_nonnegative_chk', sql`${table.noteLitres} >= 0`),
    check('fuel_delivery_compartments_received_nonnegative_chk', sql`${table.receivedLitres} >= 0`),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.deliveryId],
      foreignColumns: [fuelDeliveries.tenantId, fuelDeliveries.stationId, fuelDeliveries.id],
      name: 'fuel_delivery_compartments_delivery_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'fuel_delivery_compartments_product_fk',
    }),
  ],
);

export const fuelDeliveryCompartmentSeals = appSchema.table(
  'fuel_delivery_compartment_seals',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    stationId: uuid('station_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    compartmentId: uuid('compartment_id').notNull(),
    sealNumber: text('seal_number').notNull(),
    intact: boolean('intact').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('fuel_delivery_compartment_seals_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('fuel_delivery_compartment_seals_number_uidx').on(
      table.tenantId,
      table.compartmentId,
      table.sealNumber,
    ),
    check(
      'fuel_delivery_compartment_seals_number_chk',
      sql`length(btrim(${table.sealNumber})) between 1 and 80`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.deliveryId],
      foreignColumns: [fuelDeliveries.tenantId, fuelDeliveries.stationId, fuelDeliveries.id],
      name: 'fuel_delivery_compartment_seals_delivery_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.compartmentId],
      foreignColumns: [fuelDeliveryCompartments.tenantId, fuelDeliveryCompartments.id],
      name: 'fuel_delivery_compartment_seals_compartment_fk',
    }),
  ],
);

export const fuelDeliveryWaterTests = appSchema.table(
  'fuel_delivery_water_tests',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    stationId: uuid('station_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    result: text('result').notNull(),
    waterReadingMm: numeric('water_reading_mm', { precision: 9, scale: 2 }),
    notes: text('notes'),
    testedAt: utcTimestamp('tested_at').notNull(),
    recordedBy: uuid('recorded_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('fuel_delivery_water_tests_one_per_delivery_uidx').on(table.tenantId, table.deliveryId),
    check('fuel_delivery_water_tests_result_chk', sql`${table.result} in ('PASS', 'FAIL')`),
    check(
      'fuel_delivery_water_tests_reading_chk',
      sql`${table.waterReadingMm} is null or ${table.waterReadingMm} >= 0`,
    ),
    check(
      'fuel_delivery_water_tests_notes_chk',
      sql`${table.notes} is null or length(${table.notes}) <= 500`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.deliveryId],
      foreignColumns: [fuelDeliveries.tenantId, fuelDeliveries.stationId, fuelDeliveries.id],
      name: 'fuel_delivery_water_tests_delivery_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'fuel_delivery_water_tests_recorded_by_fk',
    }),
  ],
);

export const fuelDeliveryDriverConfirmations = appSchema.table(
  'fuel_delivery_driver_confirmations',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    stationId: uuid('station_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    driverName: text('driver_name').notNull(),
    confirmed: boolean('confirmed').notNull(),
    confirmedAt: utcTimestamp('confirmed_at'),
    notes: text('notes'),
    recordedBy: uuid('recorded_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('fuel_delivery_driver_confirmations_one_per_delivery_uidx').on(
      table.tenantId,
      table.deliveryId,
    ),
    check(
      'fuel_delivery_driver_confirmations_name_chk',
      sql`length(btrim(${table.driverName})) between 1 and 120`,
    ),
    check(
      'fuel_delivery_driver_confirmations_time_chk',
      sql`(${table.confirmed} and ${table.confirmedAt} is not null) or (not ${table.confirmed})`,
    ),
    check(
      'fuel_delivery_driver_confirmations_notes_chk',
      sql`${table.notes} is null or length(${table.notes}) <= 500`,
    ),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.deliveryId],
      foreignColumns: [fuelDeliveries.tenantId, fuelDeliveries.stationId, fuelDeliveries.id],
      name: 'fuel_delivery_driver_confirmations_delivery_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.recordedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'fuel_delivery_driver_confirmations_recorded_by_fk',
    }),
  ],
);

/** Per-owner delivery switches. Defaults keep every check advisory. */
export const deliverySettings = appSchema.table(
  'delivery_settings',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id),
    waterTestRequired: boolean('water_test_required').notNull().default(false),
    updatedBy: uuid('updated_by').notNull(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'delivery_settings_updated_by_fk',
    }),
  ],
);
