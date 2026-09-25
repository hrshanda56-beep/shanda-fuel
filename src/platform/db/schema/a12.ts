import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { memberships, stations, tenants } from './a1';
import { meterSegments, products } from './a3';
import { inventoryMovements, tanks } from './a4';
import { appSchema } from './namespaces';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });
const litresColumn = (name: string) => numeric(name, { precision: 18, scale: 3 });
const moneyColumn = (name: string) => numeric(name, { precision: 20, scale: 4 });
const wacColumn = (name: string) => numeric(name, { precision: 20, scale: 8 });

const tenantStationTankProduct = (
  table: {
    tenantId: AnyPgColumn;
    stationId: AnyPgColumn;
    tankId: AnyPgColumn;
    productId: AnyPgColumn;
  },
  name: string,
) =>
  foreignKey({
    columns: [table.tenantId, table.stationId, table.tankId, table.productId],
    foreignColumns: [tanks.tenantId, tanks.stationId, tanks.id, tanks.productId],
    name,
  });

export const inventoryCostEvents = appSchema.table(
  'inventory_cost_events',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    tankId: uuid('tank_id').notNull(),
    productId: uuid('product_id').notNull(),
    eventType: text('event_type').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    effectiveAt: utcTimestamp('effective_at').notNull(),
    businessDate: text('business_date').notNull(),
    amount: moneyColumn('amount').notNull(),
    currency: text('currency').notNull(),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('inventory_cost_events_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('inventory_cost_events_source_uidx').on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
      table.eventType,
    ),
    index('inventory_cost_events_stream_effective_idx').on(
      table.tenantId,
      table.stationId,
      table.tankId,
      table.productId,
      table.effectiveAt,
      table.id,
    ),
    check(
      'inventory_cost_events_type_ck',
      sql`${table.eventType} in ('OPENING_COST','RECEIPT_COST','SALE_COGS','COGS_REVALUATION','INVENTORY_REVALUATION','ADJUSTMENT_COST')`,
    ),
    check(
      'inventory_cost_events_sale_cogs_negative_ck',
      sql`${table.eventType} <> 'SALE_COGS' or ${table.amount} < 0`,
    ),
    check('inventory_cost_events_amount_nonzero_ck', sql`${table.amount} <> 0`),
    check('inventory_cost_events_currency_nonempty_ck', sql`btrim(${table.currency}) <> ''`),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'inventory_cost_events_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'inventory_cost_events_station_fk',
    }),
    tenantStationTankProduct(table, 'inventory_cost_events_tank_product_fk'),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'inventory_cost_events_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'inventory_cost_events_actor_fk',
    }),
  ],
);

export const inventoryCostStreamState = appSchema.table(
  'inventory_cost_stream_state',
  {
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    tankId: uuid('tank_id').notNull(),
    productId: uuid('product_id').notNull(),
    quantityLitres: litresColumn('quantity_litres').notNull().default('0'),
    inventoryValue: moneyColumn('inventory_value'),
    weightedAverageCost: wacColumn('weighted_average_cost'),
    currency: text('currency'),
    valuationStatus: text('valuation_status').notNull().default('UNVALUED'),
    lastMovementEffectiveAt: utcTimestamp('last_movement_effective_at'),
    lastMovementId: uuid('last_movement_id'),
    lastCostEventEffectiveAt: utcTimestamp('last_cost_event_effective_at'),
    lastCostEventId: uuid('last_cost_event_id'),
    projectionVersion: integer('projection_version').notNull().default(1),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.stationId, table.tankId, table.productId],
      name: 'inventory_cost_stream_state_pk',
    }),
    check('inventory_cost_stream_state_quantity_nonnegative_ck', sql`${table.quantityLitres} >= 0`),
    check(
      'inventory_cost_stream_state_status_ck',
      sql`${table.valuationStatus} in ('VALUED','UNVALUED')`,
    ),
    check(
      'inventory_cost_stream_state_valuation_pair_ck',
      sql`(${table.valuationStatus} = 'UNVALUED' and ${table.inventoryValue} is null and ${table.weightedAverageCost} is null and ${table.currency} is null) or (${table.valuationStatus} = 'VALUED' and ${table.inventoryValue} is not null and ${table.currency} is not null and btrim(${table.currency}) <> '' and (${table.quantityLitres} = 0 or ${table.weightedAverageCost} is not null))`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'inventory_cost_stream_state_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'inventory_cost_stream_state_station_fk',
    }),
    tenantStationTankProduct(table, 'inventory_cost_stream_state_tank_product_fk'),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'inventory_cost_stream_state_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lastMovementId],
      foreignColumns: [inventoryMovements.tenantId, inventoryMovements.id],
      name: 'inventory_cost_stream_state_last_movement_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lastCostEventId],
      foreignColumns: [inventoryCostEvents.tenantId, inventoryCostEvents.id],
      name: 'inventory_cost_stream_state_last_cost_event_fk',
    }),
  ],
);

export const inventorySaleCostAttributions = appSchema.table(
  'inventory_sale_cost_attributions',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    tankId: uuid('tank_id').notNull(),
    productId: uuid('product_id').notNull(),
    inventoryMovementId: uuid('inventory_movement_id').notNull(),
    meterSegmentId: uuid('meter_segment_id').notNull(),
    saleQuantityLitres: litresColumn('sale_quantity_litres').notNull(),
    preSaleWac: wacColumn('pre_sale_wac'),
    originalCogs: moneyColumn('original_cogs'),
    valuationStatus: text('valuation_status').notNull(),
    valuationBasis: text('valuation_basis').notNull(),
    replayFingerprint: text('replay_fingerprint').notNull(),
    saleCostEventId: uuid('sale_cost_event_id'),
    effectiveAt: utcTimestamp('effective_at').notNull(),
    businessDate: text('business_date').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('inventory_sale_cost_attributions_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('inventory_sale_cost_attributions_segment_uidx').on(
      table.tenantId,
      table.stationId,
      table.meterSegmentId,
    ),
    unique('inventory_sale_cost_attributions_movement_uidx').on(
      table.tenantId,
      table.stationId,
      table.inventoryMovementId,
    ),
    check(
      'inventory_sale_cost_attributions_quantity_positive_ck',
      sql`${table.saleQuantityLitres} > 0`,
    ),
    check('inventory_sale_cost_attributions_status_ck', sql`${table.valuationStatus} = 'VALUED'`),
    check(
      'inventory_sale_cost_attributions_basis_ck',
      sql`${table.valuationBasis} = 'PRE_SALE_WAC' and ${table.preSaleWac} is not null and ${table.originalCogs} is not null and ${table.saleCostEventId} is not null`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'inventory_sale_cost_attributions_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'inventory_sale_cost_attributions_station_fk',
    }),
    tenantStationTankProduct(table, 'inventory_sale_cost_attributions_tank_product_fk'),
    foreignKey({
      columns: [table.tenantId, table.inventoryMovementId],
      foreignColumns: [inventoryMovements.tenantId, inventoryMovements.id],
      name: 'inventory_sale_cost_attributions_movement_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId, table.meterSegmentId],
      foreignColumns: [meterSegments.tenantId, meterSegments.stationId, meterSegments.id],
      name: 'inventory_sale_cost_attributions_meter_segment_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.saleCostEventId],
      foreignColumns: [inventoryCostEvents.tenantId, inventoryCostEvents.id],
      name: 'inventory_sale_cost_attributions_cost_event_fk',
    }),
  ],
);

export const inventoryCostRevaluations = appSchema.table(
  'inventory_cost_revaluations',
  {
    id: id(),
    tenantId: tenantId(),
    stationId: uuid('station_id').notNull(),
    tankId: uuid('tank_id').notNull(),
    productId: uuid('product_id').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('REQUESTED'),
    effectiveAt: utcTimestamp('effective_at').notNull(),
    businessDate: text('business_date').notNull(),
    restatementFromAt: utcTimestamp('restatement_from_at'),
    restatementThroughAt: utcTimestamp('restatement_through_at'),
    requestedBy: uuid('requested_by').notNull(),
    requestedAt: utcTimestamp('requested_at').notNull().defaultNow(),
    approvedBy: uuid('approved_by'),
    approvedAt: utcTimestamp('approved_at'),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('inventory_cost_revaluations_tenant_id_id_uidx').on(table.tenantId, table.id),
    index('inventory_cost_revaluations_stream_idx').on(
      table.tenantId,
      table.stationId,
      table.tankId,
      table.productId,
      table.effectiveAt,
    ),
    check(
      'inventory_cost_revaluations_status_ck',
      sql`${table.status} in ('REQUESTED','APPROVED','REJECTED','CANCELLED','POSTED')`,
    ),
    check('inventory_cost_revaluations_reason_nonempty_ck', sql`btrim(${table.reason}) <> ''`),
    check(
      'inventory_cost_revaluations_boundary_order_ck',
      sql`${table.restatementThroughAt} is null or ${table.restatementFromAt} is null or ${table.restatementThroughAt} >= ${table.restatementFromAt}`,
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
      name: 'inventory_cost_revaluations_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.stationId],
      foreignColumns: [stations.tenantId, stations.id],
      name: 'inventory_cost_revaluations_station_fk',
    }),
    tenantStationTankProduct(table, 'inventory_cost_revaluations_tank_product_fk'),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'inventory_cost_revaluations_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.requestedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'inventory_cost_revaluations_requested_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'inventory_cost_revaluations_approved_by_fk',
    }),
  ],
);
