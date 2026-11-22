import 'server-only';

import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorizeOpeningBalanceRead, resolveOpeningBalanceCommandContext } from './application';
import type { OpeningBalanceState } from './domain';

export async function listOpeningBalanceBatchesFromRequest(request: Request, tenantId: string) {
  const context = await resolveOpeningBalanceCommandContext({
    request,
    requestedTenantId: tenantId,
  });
  authorizeOpeningBalanceRead(context);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const batches = await transaction.execute<{
      id: string;
      as_of_date: string;
      source_filename: string | null;
      source_hash: string;
      state: OpeningBalanceState;
      line_count: number;
      version: number;
      created_at: string;
      approved_at: string | null;
      locked_at: string | null;
    }>(sql`
      select id, as_of_date, source_filename, source_hash, state, line_count, version,
             created_at::text, approved_at::text, locked_at::text
      from app.opening_balance_batches
      where tenant_id = ${context.tenantId}
      order by created_at desc, id desc
    `);
    return batches.map((batch) => ({
      batchId: batch.id,
      asOfDate: batch.as_of_date,
      sourceFilename: batch.source_filename,
      sourceHash: batch.source_hash,
      state: batch.state,
      lineCount: Number(batch.line_count),
      version: Number(batch.version),
      createdAt: batch.created_at,
      approvedAt: batch.approved_at,
      lockedAt: batch.locked_at,
    }));
  });
}

/**
 * What a person can pick from when entering the opening balances of one station one question at a
 * time: its tanks and cash locations, the bank accounts of its company, and the company's credit
 * customers and suppliers. Each item says whether it already has an opening figure, so it is not
 * asked for twice. Read-only; the figures themselves go through the same batch commands as the
 * spreadsheet import.
 */
export async function getOpeningBalanceOptionsFromRequest(
  request: Request,
  tenantId: string,
  stationId: string,
) {
  const context = await resolveOpeningBalanceCommandContext({
    request,
    requestedTenantId: tenantId,
  });
  authorizeOpeningBalanceRead(context);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const stations = await transaction.execute<{
      id: string;
      code: string;
      name: string;
      legal_entity_id: string;
      legal_entity_reference: string;
      legal_entity_name: string;
    }>(sql`
      select s.id, s.code, s.name, s.legal_entity_id,
             coalesce(le.registration_reference, le.legal_name) as legal_entity_reference,
             le.legal_name as legal_entity_name
      from app.stations s
      join app.legal_entities le on le.tenant_id = s.tenant_id and le.id = s.legal_entity_id
      where s.tenant_id = ${context.tenantId} and s.id = ${stationId} and s.status <> 'RETIRED'
      limit 1
    `);
    const station = stations[0];
    if (!station) return null;

    const tanks = await transaction.execute<{
      code: string;
      fuel: string;
      capacity_litres: string;
      has_opening: boolean;
    }>(sql`
      select t.code, p.name as fuel, t.capacity_litres::text as capacity_litres,
             exists (
               select 1 from app.inventory_movements m
               where m.tenant_id = t.tenant_id and m.station_id = t.station_id
                 and m.tank_id = t.id and m.movement_type = 'OPENING_BALANCE'
             ) as has_opening
      from app.tanks t
      join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
      where t.tenant_id = ${context.tenantId} and t.station_id = ${stationId}
        and t.status = 'ACTIVE'
      order by t.code
    `);
    const cashLocations = await transaction.execute<{
      code: string;
      name: string;
      has_opening: boolean;
    }>(sql`
      select l.code, l.name,
             exists (
               select 1 from app.cash_movements c
               where c.tenant_id = l.tenant_id and c.source_type = 'OPENING_BALANCE'
                 and c.to_location_id = l.id
             ) as has_opening
      from app.cash_locations l
      where l.tenant_id = ${context.tenantId} and l.station_id = ${stationId}
        and l.status = 'ACTIVE'
      order by l.name
    `);
    const bankAccounts = await transaction.execute<{
      name: string;
      bank_name: string;
      has_opening: boolean;
    }>(sql`
      select b.name, b.bank_name,
             exists (
               select 1 from app.bank_opening_balances o
               where o.tenant_id = b.tenant_id and o.bank_account_id = b.id
             ) as has_opening
      from app.bank_accounts b
      where b.tenant_id = ${context.tenantId} and b.legal_entity_id = ${station.legal_entity_id}
        and b.status = 'ACTIVE'
      order by b.name
    `);
    const customers = await transaction.execute<{
      account_id: string;
      name: string;
      has_opening: boolean;
    }>(sql`
      select a.id::text as account_id, c.display_name as name,
             exists (
               select 1 from app.customer_ledger_entries e
               where e.tenant_id = a.tenant_id and e.account_id = a.id
                 and e.source_key = 'opening-balance:customer:' || a.id::text || ':Opening balance'
             ) as has_opening
      from app.customer_accounts a
      join app.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
      where a.tenant_id = ${context.tenantId} and a.account_type = 'CREDIT'
        and a.status <> 'CLOSED'
      order by c.display_name
    `);
    const suppliers = await transaction.execute<{ code: string; name: string }>(sql`
      select code, legal_name as name from app.suppliers
      where tenant_id = ${context.tenantId} and status = 'ACTIVE'
      order by legal_name
    `);

    return {
      station: {
        id: station.id,
        code: station.code,
        name: station.name,
        companyReference: station.legal_entity_reference,
        companyName: station.legal_entity_name,
      },
      tanks: tanks.map((t) => ({
        code: t.code,
        fuel: t.fuel,
        capacityLitres: t.capacity_litres,
        hasOpening: t.has_opening,
      })),
      cashLocations: cashLocations.map((l) => ({
        code: l.code,
        name: l.name,
        hasOpening: l.has_opening,
      })),
      bankAccounts: bankAccounts.map((b) => ({
        name: b.name,
        bankName: b.bank_name,
        hasOpening: b.has_opening,
      })),
      customers: customers.map((c) => ({
        accountId: c.account_id,
        name: c.name,
        hasOpening: c.has_opening,
      })),
      suppliers: suppliers.map((s) => ({ code: s.code, name: s.name })),
    };
  });
}

export async function getOpeningBalanceBatchFromRequest(
  request: Request,
  tenantId: string,
  batchId: string,
) {
  const context = await resolveOpeningBalanceCommandContext({
    request,
    requestedTenantId: tenantId,
  });
  authorizeOpeningBalanceRead(context);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const batches = await transaction.execute<{
      id: string;
      as_of_date: string;
      source_filename: string | null;
      source_hash: string;
      state: OpeningBalanceState;
      line_count: number;
      version: number;
      created_at: string;
      approved_at: string | null;
      locked_at: string | null;
    }>(sql`
      select id, as_of_date, source_filename, source_hash, state, line_count, version,
             created_at::text, approved_at::text, locked_at::text
      from app.opening_balance_batches
      where tenant_id = ${context.tenantId} and id = ${batchId}
      limit 1
    `);
    const batch = batches[0];
    if (!batch) return null;
    const lines = await transaction.execute<Record<string, unknown>>(sql`
      select line_number, line_key, line_type, effective_date, due_date, amount::text,
             quantity_litres::text, inventory_value::text, currency, reference, notes,
             raw_row
      from app.opening_balance_lines
      where tenant_id = ${context.tenantId} and batch_id = ${batchId}
      order by line_number
    `);
    return {
      batch: {
        batchId: batch.id,
        asOfDate: batch.as_of_date,
        sourceFilename: batch.source_filename,
        sourceHash: batch.source_hash,
        state: batch.state,
        lineCount: Number(batch.line_count),
        version: Number(batch.version),
        createdAt: batch.created_at,
        approvedAt: batch.approved_at,
        lockedAt: batch.locked_at,
      },
      lines,
    };
  });
}
