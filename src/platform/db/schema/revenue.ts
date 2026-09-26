import { sql } from 'drizzle-orm';
import {
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
import { legalEntities, memberships, stations, tenants } from './a1';
import {
  meterSegments,
  nozzles,
  products,
  reconciliationRevisions,
  reconciliations,
  shifts,
} from './a3';
import { inventoryMovements, tanks } from './a4';
import { reconciliationMeterReadings } from './a5';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });

/**
 * The one authoritative ordinary fuel-sale revenue movement.
 *
 * This table is deliberately separate from A5 declarations/readings and A4
 * inventory movements. A4 proves physical sale quantity; this row proves the
 * financial sale recognition amount for that same sealed meter segment.
 */
export const saleRecognitionMovements = appSchema.table(
  'sale_recognition_movements',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    businessDate: text('business_date').notNull(),
    productId: uuid('product_id').notNull(),
    tankId: uuid('tank_id').notNull(),
    nozzleId: uuid('nozzle_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    meterSegmentId: uuid('meter_segment_id').notNull(),
    inventorySaleMovementId: uuid('inventory_sale_movement_id').notNull(),
    reconciliationId: uuid('reconciliation_id').notNull(),
    reconciliationRevisionId: uuid('reconciliation_revision_id').notNull(),
    reconciliationMeterReadingId: uuid('reconciliation_meter_reading_id').notNull(),
    quantityLitres: numeric('quantity_litres', { precision: 18, scale: 3 }).notNull(),
    reconciliationValue: numeric('reconciliation_value', { precision: 20, scale: 4 }).notNull(),
    recognizedRevenueAmount: numeric('recognized_revenue_amount', {
      precision: 20,
      scale: 4,
    }).notNull(),
    currency: text('currency').notNull().default('USD'),
    effectiveAt: utcTimestamp('effective_at').notNull(),
    postedAt: utcTimestamp('posted_at').notNull().defaultNow(),
    classification: text('classification').notNull().default('ORDINARY_FUEL_SALE'),
    sourceType: text('source_type').notNull().default('METER_SEGMENT_SALE'),
    sourceId: uuid('source_id').notNull(),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    requestId: uuid('request_id').notNull(),
    replayFingerprint: text('replay_fingerprint').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('sale_recognition_movements_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('sale_recognition_movements_source_uidx').on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
      table.classification,
    ),
    unique('sale_recognition_movements_segment_uidx').on(
      table.tenantId,
      table.stationId,
      table.meterSegmentId,
      table.classification,
    ),
    index('sale_recognition_movements_station_business_date_idx').on(
      table.tenantId,
      table.stationId,
      table.businessDate,
    ),
    index('sale_recognition_movements_effective_idx').on(
      table.tenantId,
      table.stationId,
      table.effectiveAt,
      table.id,
    ),
    index('sale_recognition_movements_product_idx').on(
      table.tenantId,
      table.stationId,
      table.productId,
      table.businessDate,
    ),
    check(
      'sale_recognition_movements_classification_ck',
      sql`${table.classification} = 'ORDINARY_FUEL_SALE'`,
    ),
    check(
      'sale_recognition_movements_source_type_ck',
      sql`${table.sourceType} = 'METER_SEGMENT_SALE'`,
    ),
    check('sale_recognition_movements_currency_ck', sql`${table.currency} = 'USD'`),
    check('sale_recognition_movements_positive_quantity_ck', sql`${table.quantityLitres} > 0`),
    check(
      'sale_recognition_movements_positive_amount_ck',
      sql`${table.recognizedRevenueAmount} > 0`,
    ),
    check(
      'sale_recognition_movements_reconciliation_amount_ck',
      sql`${table.reconciliationValue} = ${table.recognizedRevenueAmount}`,
    ),
    check(
      'sale_recognition_movements_source_id_ck',
      sql`${table.sourceId} = ${table.meterSegmentId}`,
    ),
    check(
      'sale_recognition_movements_fingerprint_ck',
      sql`btrim(${table.replayFingerprint}) <> ''`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'sale_recognition_movements_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'sale_recognition_movements_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'sale_recognition_movements_station_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'sale_recognition_movements_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.tankId, table.productId],
      foreignColumns: [tanks.tenantId, tanks.stationId, tanks.id, tanks.productId],
      name: 'sale_recognition_movements_tank_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.nozzleId],
      foreignColumns: [nozzles.tenantId, nozzles.stationId, nozzles.id],
      name: 'sale_recognition_movements_nozzle_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.shiftId],
      foreignColumns: [shifts.tenantId, shifts.stationId, shifts.id],
      name: 'sale_recognition_movements_shift_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.meterSegmentId],
      foreignColumns: [meterSegments.tenantId, meterSegments.stationId, meterSegments.id],
      name: 'sale_recognition_movements_meter_segment_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.inventorySaleMovementId],
      foreignColumns: [inventoryMovements.tenantId, inventoryMovements.id],
      name: 'sale_recognition_movements_inventory_sale_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.reconciliationId],
      foreignColumns: [reconciliations.tenantId, reconciliations.stationId, reconciliations.id],
      name: 'sale_recognition_movements_reconciliation_fk',
    }),
    foreignKey({
      columns: [
        table.tenantId,
        table.stationId,
        table.reconciliationId,
        table.reconciliationRevisionId,
      ],
      foreignColumns: [
        reconciliationRevisions.tenantId,
        reconciliationRevisions.stationId,
        reconciliationRevisions.reconciliationId,
        reconciliationRevisions.id,
      ],
      name: 'sale_recognition_movements_revision_fk',
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
      name: 'sale_recognition_movements_meter_reading_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'sale_recognition_movements_actor_fk',
    }),
  ],
);
