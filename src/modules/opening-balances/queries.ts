import 'server-only';

import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorizeOpeningBalanceCommand, resolveOpeningBalanceCommandContext } from './application';
import type { OpeningBalanceState } from './domain';

export async function listOpeningBalanceBatchesFromRequest(request: Request, tenantId: string) {
  const context = await resolveOpeningBalanceCommandContext({
    request,
    requestedTenantId: tenantId,
  });
  authorizeOpeningBalanceCommand(context);
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

export async function getOpeningBalanceBatchFromRequest(
  request: Request,
  tenantId: string,
  batchId: string,
) {
  const context = await resolveOpeningBalanceCommandContext({
    request,
    requestedTenantId: tenantId,
  });
  authorizeOpeningBalanceCommand(context);
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
