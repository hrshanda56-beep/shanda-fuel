import type { TankRow } from '../inventory/tank-read-model';
import { profileDatabaseRead } from '../../platform/observability/read-timing';
import type { AuthenticatedActorContext } from '../identity';
import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import { isAuthorized } from '../../platform/security/permissions';
import {
  authorizeInventoryCommand,
  resolveInventoryCommandContext,
  withInventoryReadContext,
} from '../inventory/application';

const querySchema = z.object({
  tenantId: z.uuid(),
  stationId: z.uuid(),
  tankId: z.uuid().optional(),
  productId: z.uuid().optional(),
});

const revaluationQuerySchema = querySchema.extend({ revaluationId: z.uuid() });

type DbRow = Record<string, unknown>;

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function actor(value: unknown, id: unknown) {
  return { id: String(id), name: value ? String(value) : 'Unknown actor' };
}

function streamFromRow(row: DbRow) {
  const status = String(row.valuation_status) as 'VALUED' | 'UNVALUED';
  const source = row.missing_source_id
    ? {
        id: String(row.missing_source_id),
        movementType: String(row.missing_movement_type),
        sourceType: String(row.missing_source_type),
        sourceId: String(row.missing_source_reference),
        quantityLitres: String(row.missing_quantity_litres),
        effectiveAt: iso(row.missing_effective_at),
        businessDate: String(row.missing_business_date),
      }
    : null;
  return {
    station: {
      id: String(row.station_id),
      code: String(row.station_code),
      name: String(row.station_name),
    },
    tank: { id: String(row.tank_id), code: String(row.tank_code) },
    product: {
      id: String(row.product_id),
      code: String(row.product_code),
      name: String(row.product_name),
    },
    quantityLitres: String(row.quantity_litres),
    valuationStatus: status,
    inventoryValue: row.inventory_value === null ? null : String(row.inventory_value),
    weightedAverageCost:
      row.weighted_average_cost === null ? null : String(row.weighted_average_cost),
    currency: row.currency ? String(row.currency) : null,
    lastValuationOrCostEventAt: iso(row.last_cost_event_effective_at),
    lastCostEventId: row.last_cost_event_id ? String(row.last_cost_event_id) : null,
    projectionVersion: Number(row.projection_version),
    blockingReason:
      status === 'UNVALUED'
        ? source
          ? 'Authoritative cost is missing for this source movement. Sale-cost posting and reconciliation approval remain blocked until the source is valued.'
          : 'The stream does not have a complete authoritative cost chronology. Review its cost events before approving reconciliation.'
        : null,
    sourceMovementRequiringCost: source,
    activeRevaluation: row.active_revaluation_id
      ? {
          id: String(row.active_revaluation_id),
          status: String(row.active_revaluation_status),
          requestedAt: iso(row.active_revaluation_requested_at),
        }
      : null,
    hasActiveRevaluation: Boolean(row.active_revaluation_id),
  };
}

function revaluationFromRow(row: DbRow) {
  return {
    id: String(row.revaluation_id),
    status: String(row.revaluation_status),
    reason: String(row.reason),
    station: {
      id: String(row.station_id),
      code: String(row.station_code),
      name: String(row.station_name),
    },
    tank: { id: String(row.tank_id), code: String(row.tank_code) },
    product: {
      id: String(row.product_id),
      code: String(row.product_code),
      name: String(row.product_name),
    },
    source: row.source_id ? { type: String(row.source_type), id: String(row.source_id) } : null,
    amount: row.amount === null ? null : String(row.amount),
    currency: row.currency ? String(row.currency) : null,
    effectiveAt: iso(row.effective_at),
    businessDate: String(row.business_date),
    requestedBy: actor(row.requested_actor_name, row.requested_by),
    requestedAt: iso(row.requested_at),
    approvedBy: row.approved_by ? actor(row.approved_actor_name, row.approved_by) : null,
    approvedAt: iso(row.approved_at),
    postedBy: row.posted_by ? actor(row.posted_actor_name, row.posted_by) : null,
    postedAt: iso(row.posted_at),
    replayFingerprint: row.replay_fingerprint ? String(row.replay_fingerprint) : null,
    affectedSales: Number(row.affected_sales),
    costAllocation: row.cogs_delta_total
      ? {
          lateCostAmount: row.amount === null ? null : String(row.amount),
          cogsDeltaTotal: String(row.cogs_delta_total),
          impliedEndingInventoryIncrease: row.implied_ending_inventory_increase
            ? String(row.implied_ending_inventory_increase)
            : null,
        }
      : null,
  };
}

const sourceMovementSelect = sql`
  left join lateral (
    select m.id as missing_source_id,
           m.movement_type as missing_movement_type,
           m.source_type as missing_source_type,
           m.source_id as missing_source_reference,
           m.quantity_litres::text as missing_quantity_litres,
           m.effective_at as missing_effective_at,
           m.business_date as missing_business_date
    from app.inventory_movements m
    where m.tenant_id = s.tenant_id
      and m.station_id = s.station_id
      and m.tank_id = s.tank_id
      and m.product_id = s.product_id
      and m.quantity_litres > 0
      and not exists (
        select 1
        from app.inventory_cost_events ce
        where ce.tenant_id = m.tenant_id
          and ce.station_id = m.station_id
          and ce.tank_id = m.tank_id
          and ce.product_id = m.product_id
          and ce.source_type = m.source_type
          and ce.source_id = m.source_id
          and ce.event_type = case m.movement_type
            when 'OPENING_BALANCE' then 'OPENING_COST'
            when 'DELIVERY' then 'RECEIPT_COST'
            when 'POSITIVE_ADJUSTMENT' then 'ADJUSTMENT_COST'
            else '___NO_ORDINARY_COST___'
          end
      )
    order by m.effective_at, m.id
    limit 1
  ) missing_source on true
`;

const activeRevaluationJoin = sql`
  left join lateral (
    select r.id as active_revaluation_id,
           r.status as active_revaluation_status,
           r.requested_at as active_revaluation_requested_at
    from app.inventory_cost_revaluations r
    where r.tenant_id = s.tenant_id
      and r.station_id = s.station_id
      and r.tank_id = s.tank_id
      and r.product_id = s.product_id
      and r.status in ('REQUESTED', 'APPROVED')
    order by r.requested_at desc, r.id desc
    limit 1
  ) active_revaluation on true
`;

const streamFrom = sql`
  from app.inventory_cost_stream_state s
  join app.stations station on station.tenant_id = s.tenant_id and station.id = s.station_id
  join app.tanks tank on tank.tenant_id = s.tenant_id and tank.station_id = s.station_id and tank.id = s.tank_id
  join app.products product on product.tenant_id = s.tenant_id and product.id = s.product_id
  ${sourceMovementSelect}
  ${activeRevaluationJoin}
`;

const revaluationProjection = sql`
  coalesce((select count(*) from app.inventory_cost_revaluation_lines l where l.tenant_id = r.tenant_id and l.revaluation_id = r.id), 0)::integer as affected_sales,
  case when r.status = 'POSTED' then (select coalesce(sum(l.cogs_delta), 0)::text from app.inventory_cost_revaluation_lines l where l.tenant_id = r.tenant_id and l.revaluation_id = r.id) else null end as cogs_delta_total,
  case when r.status = 'POSTED' then (r.amount - coalesce((select sum(l.cogs_delta) from app.inventory_cost_revaluation_lines l where l.tenant_id = r.tenant_id and l.revaluation_id = r.id), 0))::text else null end as implied_ending_inventory_increase
`;

const revaluationFrom = sql`
  from app.inventory_cost_revaluations r
  join app.stations station on station.tenant_id = r.tenant_id and station.id = r.station_id
  join app.tanks tank on tank.tenant_id = r.tenant_id and tank.station_id = r.station_id and tank.id = r.tank_id
  join app.products product on product.tenant_id = r.tenant_id and product.id = r.product_id
`;

const actorSelect = sql`
  (select u.name from app.memberships m join app.users u on u.id = m.identity_id where m.tenant_id = r.tenant_id and m.id = r.requested_by) as requested_actor_name,
  (select u.name from app.memberships m join app.users u on u.id = m.identity_id where m.tenant_id = r.tenant_id and m.id = r.approved_by) as approved_actor_name,
  (select u.name from app.memberships m join app.users u on u.id = m.identity_id where m.tenant_id = r.tenant_id and m.id = r.posted_by) as posted_actor_name
`;

async function contextFor(request: Request, input: unknown) {
  const parsed = querySchema.parse(input);
  const context = await resolveInventoryCommandContext({
    request,
    requestedTenantId: parsed.tenantId,
    stationId: parsed.stationId,
  });
  authorizeInventoryCommand(context, 'inventory.view');
  return { context, parsed };
}

function capabilities(context: Awaited<ReturnType<typeof resolveInventoryCommandContext>>) {
  const actorInput = { actor: context.authority.authorization, requestedScope: context.scope };
  return {
    request: isAuthorized({ ...actorInput, permissionCode: 'inventory.adjustment.post' }),
    approve: isAuthorized({ ...actorInput, permissionCode: 'approval.act' }),
    post: isAuthorized({ ...actorInput, permissionCode: 'inventory.adjustment.post' }),
  };
}

export async function getInventoryValuationReadModel(
  request: Request,
  input: unknown,
  authenticatedActor?: AuthenticatedActorContext,
) {
  const parsed = querySchema.parse(input);
  const tankFilter = parsed.tankId ? sql`and s.tank_id = ${parsed.tankId}::uuid` : sql``;
  const productFilter = parsed.productId
    ? sql`and s.product_id = ${parsed.productId}::uuid`
    : sql``;
  return withInventoryReadContext(
    request,
    parsed.tenantId,
    parsed.stationId,
    async (transaction, context) => {
      const streamQuery = sql`
      select s.station_id, station.code as station_code, station.name as station_name,
             s.tank_id, tank.code as tank_code, s.product_id, product.code as product_code, product.name as product_name,
             s.quantity_litres::text, s.valuation_status, s.inventory_value::text, s.weighted_average_cost::text, s.currency,
             s.last_cost_event_effective_at, s.last_cost_event_id, s.projection_version,
             missing_source.*, active_revaluation.*
      ${streamFrom}
      where s.tenant_id = ${context.tenantId}::uuid and s.station_id = ${context.stationId}::uuid
        ${tankFilter} ${productFilter}
      order by tank.code, product.code
    `;
      const revaluationQuery = sql`
      select r.id as revaluation_id, r.status as revaluation_status, r.reason,
             r.station_id, station.code as station_code, station.name as station_name,
             r.tank_id, tank.code as tank_code, r.product_id, product.code as product_code, product.name as product_name,
             r.source_type, r.source_id, r.amount::text, r.currency, r.effective_at, r.business_date,
             r.requested_by, r.requested_at, r.approved_by, r.approved_at, r.posted_by, r.posted_at, r.replay_fingerprint,
             ${actorSelect}, ${revaluationProjection}
      ${revaluationFrom}
      where r.tenant_id = ${context.tenantId}::uuid and r.station_id = ${context.stationId}::uuid
        ${parsed.tankId ? sql`and r.tank_id = ${parsed.tankId}::uuid` : sql``}
        ${parsed.productId ? sql`and r.product_id = ${parsed.productId}::uuid` : sql``}
      order by r.requested_at desc, r.id desc
    `;
      // One database message for the independent sections; numeric values stay text.
      // Tank cards do not need sales, creditors, providers, expenses or movement IDs.
      const rows = await profileDatabaseRead<{
        streams: DbRow[];
        revaluations: DbRow[];
        tanks: TankRow[];
        business_date: string;
      }>(
        transaction,
        sql`
      with streams as (${streamQuery}), revaluations as (${revaluationQuery}),
      tanks as (
        select t.station_id::text as "stationId", t.id::text as "tankId",
          t.code as "tankCode", t.product_id::text as "productId",
          p.code as "productCode", p.name as "productName",
          t.capacity_litres::text as "capacityLitres",
          t.reorder_level_litres::text as "reorderLevelLitres",
          coalesce(m.expected, 0)::text as "expectedLitres",
          d.physical_litres::text as "physicalLitres",
          (d.physical_litres - coalesce(m.expected, 0))::text as "varianceLitres"
        from app.tanks t
        join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
        left join lateral (
          select sum(quantity_litres) as expected from app.inventory_movements m
          where m.tenant_id = t.tenant_id and m.station_id = t.station_id
            and m.tank_id = t.id and m.product_id = t.product_id
            and m.business_date <= (now() at time zone ${context.stationTimezone})::date::text
        ) m on true
        left join lateral (
          select physical_litres from app.tank_dips d
          where d.tenant_id = t.tenant_id and d.station_id = t.station_id and d.tank_id = t.id
            and d.measured_at < (((now() at time zone ${context.stationTimezone})::date + 1)::timestamp
              at time zone ${context.stationTimezone})
          order by d.measured_at desc, d.id desc limit 1
        ) d on true
        where t.tenant_id = ${context.tenantId}::uuid and t.station_id = ${context.stationId}::uuid
          and t.status <> 'RETIRED'
        order by t.code
      )
      select coalesce((select json_agg(streams) from streams), '[]'::json) as streams,
        coalesce((select json_agg(revaluations) from revaluations), '[]'::json) as revaluations,
        coalesce((select json_agg(tanks) from tanks), '[]'::json) as tanks,
        (now() at time zone ${context.stationTimezone})::date::text as business_date
    `,
      );
      const snapshot = rows[0];
      if (!snapshot)
        throw new AppError('INVARIANT_VIOLATION', 'Inventory snapshot was not returned');
      return {
        station: { id: context.stationId },
        capabilities: capabilities(context),
        streams: snapshot.streams.map(streamFromRow),
        revaluations: snapshot.revaluations.map(revaluationFromRow),
        tankReport: {
          filters: { toDate: snapshot.business_date },
          inventory: { rows: snapshot.tanks },
        },
      };
    },
    authenticatedActor,
  );
}

export async function getInventoryRevaluationReadModel(request: Request, input: unknown) {
  const parsed = revaluationQuerySchema.parse(input);
  const { context } = await contextFor(request, parsed);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<DbRow>(sql`
      select r.id as revaluation_id, r.status as revaluation_status, r.reason,
             r.station_id, station.code as station_code, station.name as station_name,
             r.tank_id, tank.code as tank_code, r.product_id, product.code as product_code, product.name as product_name,
             r.source_type, r.source_id, r.amount, r.currency, r.effective_at, r.business_date,
             r.requested_by, r.requested_at, r.approved_by, r.approved_at, r.posted_by, r.posted_at, r.replay_fingerprint,
             ${actorSelect}, ${revaluationProjection},
             s.quantity_litres as projection_quantity_litres, s.inventory_value as projection_inventory_value,
             s.weighted_average_cost as projection_wac, s.currency as projection_currency,
             s.valuation_status as projection_valuation_status, s.projection_version
      ${revaluationFrom}
      left join app.inventory_cost_stream_state s on s.tenant_id = r.tenant_id and s.station_id = r.station_id and s.tank_id = r.tank_id and s.product_id = r.product_id
      where r.tenant_id = ${context.tenantId}::uuid and r.station_id = ${context.stationId}::uuid and r.id = ${parsed.revaluationId}::uuid
      limit 1
    `);
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'The inventory cost revaluation was not found');
    const lines = await transaction.execute<DbRow>(sql`
      select l.id, l.sale_movement_id, l.sale_attribution_id, a.meter_segment_id,
             a.sale_quantity_litres, l.original_pre_sale_wac, l.recomputed_pre_sale_wac,
             l.original_cogs, l.prior_restated_cogs, l.recomputed_cogs, l.cogs_delta,
             l.currency, l.sale_effective_at, l.cogs_revaluation_event_id, l.replay_fingerprint
      from app.inventory_cost_revaluation_lines l
      join app.inventory_sale_cost_attributions a on a.tenant_id = l.tenant_id and a.id = l.sale_attribution_id
      where l.tenant_id = ${context.tenantId}::uuid and l.station_id = ${context.stationId}::uuid and l.revaluation_id = ${parsed.revaluationId}::uuid
      order by l.sale_effective_at, l.id
    `);
    const sourceRows = row.source_id
      ? await transaction.execute<DbRow>(sql`
          select id, movement_type, source_type, source_id, quantity_litres, effective_at, business_date
          from app.inventory_movements
          where tenant_id = ${context.tenantId}::uuid
            and station_id = ${context.stationId}::uuid
            and tank_id = ${String(row.tank_id)}::uuid
            and product_id = ${String(row.product_id)}::uuid
            and source_type = ${String(row.source_type)}
            and source_id = ${String(row.source_id)}::uuid
          limit 1
        `)
      : [];
    const source = sourceRows[0]
      ? {
          id: String(sourceRows[0].id),
          movementType: String(sourceRows[0].movement_type),
          sourceType: String(sourceRows[0].source_type),
          sourceId: String(sourceRows[0].source_id),
          quantityLitres: String(sourceRows[0].quantity_litres),
          effectiveAt: iso(sourceRows[0].effective_at),
          businessDate: String(sourceRows[0].business_date),
        }
      : null;
    const revaluation = revaluationFromRow(row);
    return {
      station: { id: context.stationId },
      capabilities: capabilities(context),
      revaluation: {
        ...revaluation,
        sourceMovement: source,
        currentStreamProjection: {
          quantityLitres:
            row.projection_quantity_litres === null ? null : String(row.projection_quantity_litres),
          inventoryValue:
            row.projection_inventory_value === null ? null : String(row.projection_inventory_value),
          weightedAverageCost: row.projection_wac === null ? null : String(row.projection_wac),
          currency: row.projection_currency ? String(row.projection_currency) : null,
          valuationStatus: row.projection_valuation_status
            ? String(row.projection_valuation_status)
            : null,
          projectionVersion: Number(row.projection_version ?? 0),
        },
        lines: lines.map((line) => ({
          id: String(line.id),
          saleMovementId: String(line.sale_movement_id),
          saleAttributionId: String(line.sale_attribution_id),
          meterSegmentId: String(line.meter_segment_id),
          saleQuantityLitres: String(line.sale_quantity_litres),
          originalPreSaleWac: String(line.original_pre_sale_wac),
          recomputedPreSaleWac: String(line.recomputed_pre_sale_wac),
          originalCogs: String(line.original_cogs),
          priorRestatedCogs: String(line.prior_restated_cogs),
          recomputedCogs: String(line.recomputed_cogs),
          cogsDelta: String(line.cogs_delta),
          currency: String(line.currency),
          saleEffectiveAt: iso(line.sale_effective_at),
          cogsRevaluationEventId: String(line.cogs_revaluation_event_id),
          replayFingerprint: String(line.replay_fingerprint),
        })),
        timeline: [
          {
            label: 'Source movement',
            at: iso(sourceRows[0]?.effective_at),
            actor: null,
            detail: source
              ? `${source.movementType} ${source.quantityLitres} L`
              : 'Source movement unavailable',
          },
          {
            label: 'Revaluation requested',
            at: iso(row.requested_at),
            actor: actor(row.requested_actor_name, row.requested_by),
            detail: String(row.reason),
          },
          ...(row.approved_at
            ? [
                {
                  label: 'Revaluation approved',
                  at: iso(row.approved_at),
                  actor: actor(row.approved_actor_name, row.approved_by),
                  detail: 'Workflow approval recorded',
                },
              ]
            : []),
          ...(row.posted_at
            ? [
                {
                  label: 'Revaluation posted',
                  at: iso(row.posted_at),
                  actor: actor(row.posted_actor_name, row.posted_by),
                  detail: `${lines.length} historical sale${lines.length === 1 ? '' : 's'} adjusted`,
                },
              ]
            : []),
        ],
      },
    };
  });
}
