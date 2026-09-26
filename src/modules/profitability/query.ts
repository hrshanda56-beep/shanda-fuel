import 'server-only';

import { sql } from 'drizzle-orm';
import type { Database } from '../../platform/db';
import { normalizeValuedSaleCogs, summarizeRestatedCogs } from './domain';
import type { RestatedCogsQueryFilters, RestatedCogsReport, RestatedSaleCogs } from './contracts';

type ProfitabilityTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type RestatedCogsRow = {
  station_id: string;
  reconciliation_id: string;
  revision_id: string;
  meter_segment_id: string;
  sale_movement_id: string;
  attribution_id: string | null;
  original_sale_cogs_event_id: string | null;
  validated_sale_cogs_event_id: string | null;
  original_cogs: string | null;
  revaluation_delta: string | null;
  revaluation_line_ids: string[] | null;
  revaluation_event_ids: string[] | null;
  restated_business_date: string;
  effective_at: Date | string;
  sale_event_currency: string | null;
};

const FINALIZED_REVISION_STATES = sql`('APPROVED', 'POSTED', 'LOCKED')`;

function stationClause(alias: string, stationId?: string) {
  return stationId ? sql`and ${sql.raw(`${alias}.station_id`)} = ${stationId}` : sql``;
}

function toIso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('Canonical sale effective_at must be a valid timestamp');
  }
  return parsed.toISOString();
}

function normalizedArray(value: string[] | null): readonly string[] {
  return value ?? [];
}

function isValidatedSaleCost(row: RestatedCogsRow): boolean {
  return (
    row.attribution_id !== null &&
    row.original_cogs !== null &&
    row.original_sale_cogs_event_id !== null &&
    row.validated_sale_cogs_event_id !== null &&
    row.sale_event_currency === 'USD'
  );
}

function mapSale(row: RestatedCogsRow): RestatedSaleCogs {
  const valued = isValidatedSaleCost(row);
  const originalSaleCogsEventId = row.original_sale_cogs_event_id;
  const originalCogs = valued ? row.original_cogs! : null;
  const revaluationDelta = valued ? (row.revaluation_delta ?? '0') : null;
  const amounts = valued
    ? normalizeValuedSaleCogs({
        originalCogs: originalCogs!,
        revaluationDelta: revaluationDelta!,
      })
    : { originalCogs: null, revaluationDelta: null, restatedCogs: null };

  return {
    stationId: row.station_id,
    reconciliationId: row.reconciliation_id,
    revisionId: row.revision_id,
    meterSegmentId: row.meter_segment_id,
    saleMovementId: row.sale_movement_id,
    attributionId: row.attribution_id,
    originalSaleCogsEventId,
    ...amounts,
    revaluationLineIds: normalizedArray(row.revaluation_line_ids),
    revaluationEventIds: normalizedArray(row.revaluation_event_ids),
    businessDate: row.restated_business_date,
    effectiveAt: toIso(row.effective_at),
    currency: row.sale_event_currency,
    valuationStatus: valued ? 'VALUED' : 'UNVALUED',
  };
}

/**
 * Shared A10 read abstraction for canonical restated COGS.
 *
 * The query starts with the latest finalized A5 revision, follows the
 * persisted A5 segment bridge to the canonical A4 SALE movement, validates
 * immutable A12 original-cost evidence, and adds only POSTED A12 revaluation
 * line/event evidence. It never replays WAC or derives cost from inventory
 * quantity/value.
 */
export async function readRestatedCogs(
  transaction: ProfitabilityTransaction,
  filters: RestatedCogsQueryFilters,
): Promise<RestatedCogsReport> {
  const rows = await transaction.execute<RestatedCogsRow>(sql`
    with latest_finalized_revisions as (
      select distinct on (r.id)
        r.id as reconciliation_id,
        r.station_id,
        rev.id as revision_id
      from app.reconciliations r
      join app.reconciliation_revisions rev
        on rev.tenant_id = r.tenant_id
       and rev.station_id = r.station_id
       and rev.reconciliation_id = r.id
      where r.tenant_id = ${filters.tenantId}
        and rev.state in ${FINALIZED_REVISION_STATES}
        ${stationClause('r', filters.stationId)}
      order by r.id, rev.revision desc
    ),
    posted_revaluation_evidence as (
      select
        line.tenant_id,
        line.station_id,
        line.tank_id,
        line.product_id,
        line.sale_movement_id,
        line.sale_attribution_id,
        sum(line.cogs_delta)::text as revaluation_delta,
        array_agg(line.id order by line.sale_effective_at, line.id) as revaluation_line_ids,
        array_agg(event.id order by line.sale_effective_at, line.id) as revaluation_event_ids
      from app.inventory_cost_revaluation_lines line
      join app.inventory_cost_revaluations revaluation
        on revaluation.tenant_id = line.tenant_id
       and revaluation.station_id = line.station_id
       and revaluation.id = line.revaluation_id
       and revaluation.status = 'POSTED'
       and revaluation.currency = 'USD'
      join app.inventory_cost_events event
        on event.tenant_id = line.tenant_id
       and event.station_id = line.station_id
       and event.id = line.cogs_revaluation_event_id
       and event.event_type = 'COGS_REVALUATION'
       and event.source_type = 'INVENTORY_COST_REVALUATION_LINE'
       and event.source_id = line.id
       and event.tank_id = line.tank_id
       and event.product_id = line.product_id
       and event.amount = line.cogs_delta
       and event.effective_at = line.sale_effective_at
       and event.currency = 'USD'
       and event.currency = line.currency
      where line.tenant_id = ${filters.tenantId}
        ${stationClause('line', filters.stationId)}
      group by
        line.tenant_id,
        line.station_id,
        line.tank_id,
        line.product_id,
        line.sale_movement_id,
        line.sale_attribution_id
    )
    select
      latest.station_id,
      latest.reconciliation_id,
      latest.revision_id,
      segment.id as meter_segment_id,
      movement.id as sale_movement_id,
      attribution.id as attribution_id,
      attribution.sale_cost_event_id as original_sale_cogs_event_id,
      validated_sale_event.id as validated_sale_cogs_event_id,
      attribution.original_cogs::text as original_cogs,
      coalesce(revaluation.revaluation_delta, '0') as revaluation_delta,
      coalesce(revaluation.revaluation_line_ids, ARRAY[]::uuid[]) as revaluation_line_ids,
      coalesce(revaluation.revaluation_event_ids, ARRAY[]::uuid[]) as revaluation_event_ids,
      movement.business_date as restated_business_date,
      movement.effective_at,
      sale_event.currency as sale_event_currency
    from latest_finalized_revisions latest
    join app.reconciliation_meter_reading_segments bridge
      on bridge.tenant_id = ${filters.tenantId}
     and bridge.station_id = latest.station_id
     and bridge.reconciliation_id = latest.reconciliation_id
     and bridge.revision_id = latest.revision_id
     and bridge.allocated_litres > 0
    join app.meter_segments segment
      on segment.tenant_id = ${filters.tenantId}
     and segment.station_id = latest.station_id
     and segment.id = bridge.meter_segment_id
    join app.inventory_movements movement
      on movement.tenant_id = ${filters.tenantId}
     and movement.station_id = latest.station_id
     and movement.movement_type = 'SALE'
     and movement.source_type = 'METER_SEGMENT_SALE'
     and movement.source_id = segment.id
     and movement.business_date between ${filters.fromDate} and ${filters.toDate}
    left join app.inventory_sale_cost_attributions attribution
      on attribution.tenant_id = movement.tenant_id
     and attribution.station_id = movement.station_id
     and attribution.inventory_movement_id = movement.id
     and attribution.meter_segment_id = segment.id
    left join app.inventory_cost_events sale_event
      on sale_event.tenant_id = attribution.tenant_id
     and sale_event.station_id = attribution.station_id
     and sale_event.id = attribution.sale_cost_event_id
    left join app.inventory_cost_events validated_sale_event
      on validated_sale_event.tenant_id = attribution.tenant_id
     and validated_sale_event.station_id = attribution.station_id
     and validated_sale_event.id = attribution.sale_cost_event_id
     and validated_sale_event.event_type = 'SALE_COGS'
     and validated_sale_event.source_type = 'METER_SEGMENT_SALE'
     and validated_sale_event.source_id = segment.id
     and attribution.valuation_status = 'VALUED'
     and attribution.valuation_basis = 'PRE_SALE_WAC'
     and attribution.pre_sale_wac is not null
     and attribution.original_cogs is not null
     and attribution.original_cogs > 0
     and attribution.tank_id = movement.tank_id
     and attribution.product_id = movement.product_id
     and attribution.effective_at = movement.effective_at
     and attribution.business_date = movement.business_date
     and attribution.sale_quantity_litres = -movement.quantity_litres
     and validated_sale_event.tank_id = movement.tank_id
     and validated_sale_event.product_id = movement.product_id
     and validated_sale_event.effective_at = movement.effective_at
     and validated_sale_event.business_date = movement.business_date
     and validated_sale_event.amount = -attribution.original_cogs
     and validated_sale_event.currency = 'USD'
    left join posted_revaluation_evidence revaluation
      on revaluation.tenant_id = movement.tenant_id
     and revaluation.station_id = movement.station_id
     and revaluation.tank_id = movement.tank_id
     and revaluation.product_id = movement.product_id
     and revaluation.sale_movement_id = movement.id
     and revaluation.sale_attribution_id = attribution.id
    order by movement.business_date, movement.effective_at, movement.id
  `);

  const sales = rows.map(mapSale);
  return { ...summarizeRestatedCogs(sales), sales };
}
