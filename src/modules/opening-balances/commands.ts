import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { ExactDecimal } from '../../platform/domain/primitives';
import { inventoryMovements } from '../../platform/db/schema/a4';
import {
  openingBalanceBatches,
  openingBalanceLines,
  bankOpeningBalances,
} from '../../platform/db/schema/opening-balances';
import {
  persistHistoricalLateSourceUnvaluedProjectionInTransaction,
  persistInventoryCostProjectionInTransaction,
  postOpeningInventoryCostInTransaction,
} from '../costing';
import {
  parseOpeningBalanceCsv,
  type OpeningCsvParseResult,
  type ParsedOpeningLine,
} from './domain';
import {
  authorizeOpeningBalanceCommand,
  executeOpeningBalanceCommand,
  requestHash,
  resolveOpeningBalanceCommandContext,
  type OpeningBalanceCommandContext,
  type OpeningBalanceTransaction,
} from './application';
import { withTenantTransaction } from '../../platform/db/transaction';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const base = z.object({ tenantId: uuid });
const previewSchema = base.extend({
  commandType: z.literal('PreviewOpeningBalanceImport'),
  csv: z.string().min(1).max(10_000_000),
});
const createSchema = base.extend({
  commandType: z.literal('CreateOpeningBalanceBatch'),
  asOfDate: date,
  csv: z.string().min(1).max(10_000_000),
  sourceFilename: z.string().trim().max(255).optional(),
});
const transitionSchema = base.extend({
  batchId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});

type ResolvedLine = ParsedOpeningLine & {
  id: string;
  legalEntityId: string | null;
  stationId: string | null;
  supplierId: string | null;
  customerId: string | null;
  accountId: string | null;
  cashLocationId: string | null;
  bankAccountId: string | null;
  tankId: string | null;
  productId: string | null;
};

type StoredLineRow = ResolvedLine;

type ResolutionIssue = Readonly<{ lineNumber: number; field: string; message: string }>;
type ExistingBatch = Readonly<{ id: string; state: string }>;

function idempotencyKey(request: Request): string {
  return request.headers.get('idempotency-key')?.trim() ?? '';
}

function asOfDateIsValid(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateAtMidnight(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function normalizeLine(row: ParsedOpeningLine): ResolvedLine {
  return {
    ...row,
    id: randomUUID(),
    legalEntityId: null,
    stationId: null,
    supplierId: null,
    customerId: null,
    accountId: null,
    cashLocationId: null,
    bankAccountId: null,
    tankId: null,
    productId: null,
  };
}

function issue(line: ParsedOpeningLine, field: string, message: string): ResolutionIssue {
  return { lineNumber: line.lineNumber, field, message };
}

async function findBatchBySourceHash(
  transaction: OpeningBalanceTransaction,
  context: OpeningBalanceCommandContext,
  sourceHash: string,
): Promise<ExistingBatch | null> {
  const rows = await transaction.execute<ExistingBatch>(sql`
    select id, state
    from app.opening_balance_batches
    where tenant_id = ${context.tenantId} and source_hash = ${sourceHash}
    limit 1
  `);
  return rows[0] ?? null;
}

async function resolveLines(
  transaction: OpeningBalanceTransaction,
  context: OpeningBalanceCommandContext,
  rows: readonly ParsedOpeningLine[],
  asOfDate?: string,
): Promise<{ lines: ResolvedLine[]; issues: ResolutionIssue[] }> {
  const lines = rows.map(normalizeLine);
  const issues: ResolutionIssue[] = [];
  for (const line of lines) {
    if (asOfDate && line.effectiveDate > asOfDate)
      issues.push(
        issue(line, 'effective_date', 'The effective date cannot be after the batch as-of date.'),
      );
    let legalEntityId: string | null = null;
    if (line.legalEntityReference) {
      const entities = await transaction.execute<{
        id: string;
        legal_name: string;
        registration_reference: string | null;
      }>(sql`
        select id, legal_name, registration_reference from app.legal_entities
        where tenant_id = ${context.tenantId} and status = 'ACTIVE'
          and (legal_name = ${line.legalEntityReference} or registration_reference = ${line.legalEntityReference})
        limit 2
      `);
      if (entities.length !== 1)
        issues.push(
          issue(
            line,
            'legal_entity_reference',
            entities.length
              ? 'The company reference matches more than one active company.'
              : 'The active company was not found.',
          ),
        );
      else legalEntityId = entities[0]!.id;
    }
    let stationId: string | null = null;
    let stationLegalEntityId: string | null = null;
    if (line.stationCode) {
      const stations = await transaction.execute<{ id: string; legal_entity_id: string }>(sql`
        select id, legal_entity_id from app.stations
        where tenant_id = ${context.tenantId} and code = ${line.stationCode} and status <> 'RETIRED'
        limit 2
      `);
      if (stations.length !== 1)
        issues.push(
          issue(
            line,
            'station_code',
            stations.length
              ? 'The station code matches more than one station.'
              : 'The station was not found.',
          ),
        );
      else {
        stationId = stations[0]!.id;
        stationLegalEntityId = stations[0]!.legal_entity_id;
        if (legalEntityId && legalEntityId !== stationLegalEntityId)
          issues.push(
            issue(line, 'legal_entity_reference', 'The station belongs to a different company.'),
          );
        legalEntityId ??= stationLegalEntityId;
      }
    }
    if (line.lineType === 'SUPPLIER_INVOICE') {
      const suppliers = await transaction.execute<{ id: string }>(sql`
        select id from app.suppliers where tenant_id = ${context.tenantId} and code = ${line.supplierCode} and status = 'ACTIVE' limit 2
      `);
      if (suppliers.length !== 1)
        issues.push(
          issue(
            line,
            'supplier_code',
            suppliers.length
              ? 'The supplier code is ambiguous.'
              : 'The active supplier was not found.',
          ),
        );
      else line.supplierId = suppliers[0]!.id;
      if (!legalEntityId)
        issues.push(
          issue(line, 'legal_entity_reference', 'A supplier invoice must name its company.'),
        );
      if (line.supplierId && line.reference) {
        const duplicate = await transaction.execute<{ id: string }>(sql`
          select id from app.supplier_documents where tenant_id = ${context.tenantId} and supplier_id = ${line.supplierId}
            and reference_number = ${line.reference} and state <> 'REVERSED' limit 1
        `);
        if (duplicate.length)
          issues.push(issue(line, 'reference', 'This supplier invoice reference already exists.'));
      }
    } else if (line.lineType === 'CUSTOMER_CHARGE') {
      const accounts = await transaction.execute<{
        account_id: string;
        customer_id: string;
        account_type: string;
        status: string;
      }>(sql`
        select a.id as account_id, a.customer_id, a.account_type, a.status
        from app.customer_accounts a
        join app.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
        where a.tenant_id = ${context.tenantId} and (a.id::text = ${line.accountReference} or c.account_reference = ${line.accountReference})
        limit 2
      `);
      if (accounts.length !== 1)
        issues.push(
          issue(
            line,
            'account_reference',
            accounts.length
              ? 'The customer account reference is ambiguous.'
              : 'The customer account was not found.',
          ),
        );
      else {
        const account = accounts[0]!;
        if (account.account_type !== 'CREDIT')
          issues.push(
            issue(line, 'account_reference', 'Opening customer debt must use a CREDIT account.'),
          );
        if (account.status === 'CLOSED')
          issues.push(
            issue(
              line,
              'account_reference',
              'A closed customer account cannot receive an opening charge.',
            ),
          );
        line.accountId = account.account_id;
        line.customerId = account.customer_id;
        if (line.reference) {
          const duplicate = await transaction.execute<{ id: string }>(sql`
            select id
            from app.customer_ledger_entries
            where tenant_id = ${context.tenantId}
              and account_id = ${line.accountId}
              and source_key = ${`opening-balance:customer:${line.accountId}:${line.reference}`}
            limit 1
          `);
          if (duplicate.length)
            issues.push(
              issue(
                line,
                'reference',
                'This customer opening charge reference already exists for the account.',
              ),
            );
        }
      }
    } else if (line.lineType === 'CASH_BALANCE') {
      const locations = await transaction.execute<{ id: string; station_id: string }>(sql`
        select l.id, l.station_id from app.cash_locations l
        where l.tenant_id = ${context.tenantId} and l.station_id = ${stationId} and l.code = ${line.cashLocationCode} and l.status = 'ACTIVE'
        limit 2
      `);
      if (locations.length !== 1)
        issues.push(
          issue(
            line,
            'cash_location_code',
            locations.length
              ? 'The cash location is ambiguous.'
              : 'The active cash location was not found for this station.',
          ),
        );
      else line.cashLocationId = locations[0]!.id;
      if (line.cashLocationId) {
        const duplicate = await transaction.execute<{ id: string }>(sql`
          select id from app.cash_movements where tenant_id = ${context.tenantId} and source_type = 'OPENING_BALANCE' and to_location_id = ${line.cashLocationId} limit 1
        `);
        if (duplicate.length)
          issues.push(
            issue(line, 'cash_location_code', 'This cash location already has an opening balance.'),
          );
      }
    } else if (line.lineType === 'BANK_BALANCE') {
      if (!legalEntityId)
        issues.push(issue(line, 'legal_entity_reference', 'A bank balance must name its company.'));
      const accounts = await transaction.execute<{ id: string; legal_entity_id: string }>(sql`
        select id, legal_entity_id from app.bank_accounts where tenant_id = ${context.tenantId} and legal_entity_id = ${legalEntityId} and name = ${line.bankAccountName} and status = 'ACTIVE' limit 2
      `);
      if (accounts.length !== 1)
        issues.push(
          issue(
            line,
            'bank_account_name',
            accounts.length
              ? 'The bank account name is ambiguous.'
              : 'The active bank account was not found.',
          ),
        );
      else line.bankAccountId = accounts[0]!.id;
      if (line.bankAccountId) {
        const duplicate = await transaction.execute<{ id: string }>(sql`
          select id from app.bank_opening_balances where tenant_id = ${context.tenantId} and bank_account_id = ${line.bankAccountId} limit 1
        `);
        if (duplicate.length)
          issues.push(
            issue(line, 'bank_account_name', 'This bank account already has an opening balance.'),
          );
      }
    } else if (line.lineType === 'TANK_STOCK') {
      const tanks = await transaction.execute<{
        id: string;
        product_id: string;
        capacity_litres: string;
      }>(sql`
        select id, product_id, capacity_litres::text from app.tanks
        where tenant_id = ${context.tenantId} and station_id = ${stationId} and code = ${line.tankCode} and status = 'ACTIVE' limit 2
      `);
      if (tanks.length !== 1)
        issues.push(
          issue(
            line,
            'tank_code',
            tanks.length
              ? 'The tank code is ambiguous.'
              : 'The active tank was not found for this station.',
          ),
        );
      else {
        const tank = tanks[0]!;
        line.tankId = tank.id;
        line.productId = tank.product_id;
        if (
          line.quantityLitres &&
          new ExactDecimal(line.quantityLitres).value.gt(tank.capacity_litres)
        )
          issues.push(issue(line, 'quantity_litres', 'Opening stock cannot exceed tank capacity.'));
        const duplicate = await transaction.execute<{ id: string }>(sql`
          select id from app.inventory_movements where tenant_id = ${context.tenantId} and station_id = ${stationId} and tank_id = ${line.tankId} and movement_type = 'OPENING_BALANCE' limit 1
        `);
        if (duplicate.length)
          issues.push(issue(line, 'tank_code', 'This tank already has an opening stock balance.'));
      }
    }
    line.legalEntityId = legalEntityId;
    line.stationId = stationId;
  }
  return { lines, issues };
}

function previewResponse(
  parsed: OpeningCsvParseResult,
  resolved: { lines: ResolvedLine[]; issues: ResolutionIssue[] },
  sourceHash: string,
  existingBatch: ExistingBatch | null,
) {
  return {
    valid: parsed.issues.length === 0 && resolved.issues.length === 0 && !existingBatch,
    sourceHash,
    duplicateBatch: existingBatch,
    rowCount: parsed.rows.length,
    parserIssues: parsed.issues,
    resolutionIssues: resolved.issues,
    lines: resolved.lines.map((line) => ({
      lineNumber: line.lineNumber,
      lineKey: line.lineKey,
      lineType: line.lineType,
      effectiveDate: line.effectiveDate,
      amount: line.amount,
      quantityLitres: line.quantityLitres,
      inventoryValue: line.inventoryValue,
      resolved: Boolean(
        line.legalEntityId || line.stationId || line.accountId || line.bankAccountId || line.tankId,
      ),
    })),
  };
}

export async function previewOpeningBalanceImportFromRequest(request: Request, body: unknown) {
  const input = previewSchema.parse(body);
  const context = await resolveOpeningBalanceCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  authorizeOpeningBalanceCommand(context);
  const parsed = parseOpeningBalanceCsv(input.csv);
  const sourceHash = createHash('sha256').update(input.csv).digest('hex');
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const resolved = parsed.issues.length
      ? { lines: [], issues: [] }
      : await resolveLines(transaction, context, parsed.rows);
    const existingBatch = await findBatchBySourceHash(transaction, context, sourceHash);
    return previewResponse(parsed, resolved, sourceHash, existingBatch);
  });
}

export async function createOpeningBalanceBatchFromRequest(request: Request, body: unknown) {
  const input = createSchema.parse(body);
  if (!asOfDateIsValid(input.asOfDate))
    throw new AppError('VALIDATION_FAILED', 'The batch as-of date is not valid.');
  const context = await resolveOpeningBalanceCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  const parsed = parseOpeningBalanceCsv(input.csv);
  const sourceHash = createHash('sha256').update(input.csv).digest('hex');
  if (parsed.issues.length)
    throw new AppError(
      'VALIDATION_FAILED',
      'The CSV needs corrections before it can be imported.',
      { issues: parsed.issues },
    );
  return executeOpeningBalanceCommand({
    context,
    commandType: 'CreateOpeningBalanceBatch',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'OPENING_BALANCE.BATCH_CREATED',
      subjectId: (result) => (result as { batchId: string }).batchId,
    },
    execute: async (transaction) => {
      const resolved = await resolveLines(transaction, context, parsed.rows, input.asOfDate);
      if (resolved.issues.length)
        throw new AppError(
          'VALIDATION_FAILED',
          'The CSV contains references that cannot be imported.',
          { issues: resolved.issues },
        );
      const existingBatch = await findBatchBySourceHash(transaction, context, sourceHash);
      if (existingBatch)
        throw new AppError(
          'CONFLICT',
          'This CSV has already been imported as an opening balance batch.',
          { batchId: existingBatch.id, state: existingBatch.state },
        );
      const batchId = randomUUID();
      await transaction.insert(openingBalanceBatches).values({
        id: batchId,
        tenantId: context.tenantId,
        asOfDate: input.asOfDate,
        sourceFilename: input.sourceFilename ?? null,
        sourceHash,
        state: 'DRAFT',
        lineCount: resolved.lines.length,
        createdBy: context.authority.membership.membershipId,
      });
      await transaction.insert(openingBalanceLines).values(
        resolved.lines.map((line) => ({
          id: line.id,
          tenantId: context.tenantId,
          batchId,
          lineNumber: line.lineNumber,
          lineKey: line.lineKey,
          lineType: line.lineType,
          legalEntityId: line.legalEntityId,
          stationId: line.stationId,
          supplierId: line.supplierId,
          customerId: line.customerId,
          accountId: line.accountId,
          cashLocationId: line.cashLocationId,
          bankAccountId: line.bankAccountId,
          tankId: line.tankId,
          productId: line.productId,
          reference: line.reference,
          effectiveDate: line.effectiveDate,
          dueDate: line.dueDate,
          amount: line.amount,
          quantityLitres: line.quantityLitres,
          inventoryValue: line.inventoryValue,
          currency: line.currency,
          notes: line.notes,
          rawRow: line.rawRow,
        })),
      );
      return {
        batchId,
        state: 'DRAFT' as const,
        version: 0,
        lineCount: resolved.lines.length,
        sourceHash,
      };
    },
  });
}

async function loadBatchForUpdate(
  transaction: OpeningBalanceTransaction,
  context: OpeningBalanceCommandContext,
  batchId: string,
) {
  const rows = await transaction.execute<{
    id: string;
    state: string;
    version: number;
    line_count: number;
    approved_by: string | null;
  }>(sql`
    select id, state, version, line_count, approved_by from app.opening_balance_batches where tenant_id = ${context.tenantId} and id = ${batchId} for update
  `);
  const batch = rows[0];
  if (!batch) throw new AppError('NOT_FOUND', 'The opening balance batch was not found.');
  return batch;
}

async function revalidateStoredLines(
  transaction: OpeningBalanceTransaction,
  context: OpeningBalanceCommandContext,
  batchId: string,
) {
  const lines = await transaction.execute<StoredLineRow>(sql`
    select id, line_number as "lineNumber", line_key as "lineKey", line_type as "lineType", legal_entity_id as "legalEntityId", station_id as "stationId", supplier_id as "supplierId", customer_id as "customerId", account_id as "accountId", cash_location_id as "cashLocationId", bank_account_id as "bankAccountId", tank_id as "tankId", product_id as "productId", reference, effective_date as "effectiveDate", due_date as "dueDate", amount::text as amount, quantity_litres::text as "quantityLitres", inventory_value::text as "inventoryValue", currency, notes, raw_row as "rawRow"
    from app.opening_balance_lines where tenant_id = ${context.tenantId} and batch_id = ${batchId} order by line_number
  `);
  const issues: ResolutionIssue[] = [];
  for (const line of lines) {
    if (line.lineType === 'SUPPLIER_INVOICE') {
      const duplicate = await transaction.execute<{ id: string }>(
        sql`select id from app.supplier_documents where tenant_id = ${context.tenantId} and supplier_id = ${line.supplierId} and reference_number = ${line.reference} and state <> 'REVERSED' limit 1`,
      );
      if (duplicate.length)
        issues.push({
          lineNumber: line.lineNumber,
          field: 'reference',
          message: 'This supplier invoice reference already exists.',
        });
    } else if (line.lineType === 'BANK_BALANCE') {
      const duplicate = await transaction.execute<{ id: string }>(
        sql`select id from app.bank_opening_balances where tenant_id = ${context.tenantId} and bank_account_id = ${line.bankAccountId} limit 1`,
      );
      if (duplicate.length)
        issues.push({
          lineNumber: line.lineNumber,
          field: 'bank_account_name',
          message: 'This bank account already has an opening balance.',
        });
    } else if (line.lineType === 'CASH_BALANCE') {
      const duplicate = await transaction.execute<{ id: string }>(
        sql`select id from app.cash_movements where tenant_id = ${context.tenantId} and source_type = 'OPENING_BALANCE' and to_location_id = ${line.cashLocationId} limit 1`,
      );
      if (duplicate.length)
        issues.push({
          lineNumber: line.lineNumber,
          field: 'cash_location_code',
          message: 'This cash location already has an opening balance.',
        });
    } else if (line.lineType === 'TANK_STOCK') {
      const duplicate = await transaction.execute<{ id: string }>(
        sql`select id from app.inventory_movements where tenant_id = ${context.tenantId} and station_id = ${line.stationId} and tank_id = ${line.tankId} and movement_type = 'OPENING_BALANCE' limit 1`,
      );
      if (duplicate.length)
        issues.push({
          lineNumber: line.lineNumber,
          field: 'tank_code',
          message: 'This tank already has opening stock.',
        });
    } else if (line.lineType === 'CUSTOMER_CHARGE') {
      const duplicate = await transaction.execute<{ id: string }>(sql`
        select id
        from app.customer_ledger_entries
        where tenant_id = ${context.tenantId}
          and account_id = ${line.accountId}
          and source_key = ${`opening-balance:customer:${line.accountId}:${line.reference}`}
        limit 1
      `);
      if (duplicate.length)
        issues.push({
          lineNumber: line.lineNumber,
          field: 'reference',
          message: 'This customer opening charge reference already exists for the account.',
        });
    }
  }
  return { lines, issues };
}

export async function approveOpeningBalanceBatchFromRequest(request: Request, body: unknown) {
  const input = transitionSchema.parse(body);
  const context = await resolveOpeningBalanceCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  return executeOpeningBalanceCommand({
    context,
    commandType: 'ApproveOpeningBalanceBatch',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: { actionCode: 'OPENING_BALANCE.BATCH_APPROVED', subjectId: input.batchId },
    execute: async (transaction) => {
      const batch = await loadBatchForUpdate(transaction, context, input.batchId);
      if (batch.version !== input.expectedVersion)
        throw new AppError('CONFLICT', 'Refresh the opening balance batch before approving it.');
      if (batch.state !== 'DRAFT')
        throw new AppError('CONFLICT', 'Only a draft opening balance batch can be approved.');
      const checked = await revalidateStoredLines(transaction, context, input.batchId);
      if (checked.issues.length)
        throw new AppError('CONFLICT', 'The source data changed; review the batch again.', {
          issues: checked.issues,
        });
      await transaction.execute(
        sql`update app.opening_balance_batches set state = 'APPROVED', approved_by = ${context.authority.membership.membershipId}, approved_at = now(), version = version + 1, updated_at = now() where tenant_id = ${context.tenantId} and id = ${input.batchId} and version = ${input.expectedVersion}`,
      );
      return {
        batchId: input.batchId,
        state: 'APPROVED' as const,
        version: input.expectedVersion + 1,
      };
    },
  });
}

export async function lockOpeningBalanceBatchFromRequest(request: Request, body: unknown) {
  const input = transitionSchema.parse(body);
  const context = await resolveOpeningBalanceCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  return executeOpeningBalanceCommand({
    context,
    commandType: 'LockOpeningBalanceBatch',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: { actionCode: 'OPENING_BALANCE.BATCH_LOCKED', subjectId: input.batchId },
    execute: async (transaction) => {
      const batch = await loadBatchForUpdate(transaction, context, input.batchId);
      if (batch.version !== input.expectedVersion)
        throw new AppError('CONFLICT', 'Refresh the opening balance batch before locking it.');
      if (batch.state !== 'APPROVED')
        throw new AppError('CONFLICT', 'Only an approved opening balance batch can be locked.');
      const checked = await revalidateStoredLines(transaction, context, input.batchId);
      if (checked.issues.length)
        throw new AppError('CONFLICT', 'The source data changed; the batch cannot be locked.', {
          issues: checked.issues,
        });
      const lines = checked.lines;
      for (const line of lines) {
        const effectiveAt = dateAtMidnight(line.effectiveDate);
        if (line.lineType === 'SUPPLIER_INVOICE') {
          const documentId = randomUUID();
          const creditPeriodDays = line.dueDate
            ? Math.round(
                (dateAtMidnight(line.dueDate).getTime() - effectiveAt.getTime()) / 86_400_000,
              )
            : null;
          await transaction.execute(sql`
            insert into app.supplier_documents (id, tenant_id, legal_entity_id, supplier_id, document_type, reference_number, document_date, due_date, currency, amount, state, version, created_by, submitted_by, submitted_at, posted_by, posted_at, payment_terms, credit_period_days)
            values (${documentId}, ${context.tenantId}, ${line.legalEntityId}, ${line.supplierId}, 'INVOICE', ${line.reference}, ${line.effectiveDate}, ${line.dueDate}, 'USD', ${line.amount}, 'POSTED', 1, ${context.authority.membership.membershipId}, ${context.authority.membership.membershipId}, now(), ${context.authority.membership.membershipId}, now(), ${line.dueDate ? 'CREDIT' : null}, ${creditPeriodDays})
          `);
          await transaction.execute(sql`
            insert into app.supplier_account_movements (id, tenant_id, legal_entity_id, supplier_id, movement_type, amount, currency, source_type, source_id, effective_date, actor_membership_id)
            values (${randomUUID()}, ${context.tenantId}, ${line.legalEntityId}, ${line.supplierId}, 'INVOICE', ${line.amount}, 'USD', 'OPENING_BALANCE', ${documentId}, ${line.effectiveDate}, ${context.authority.membership.membershipId})
          `);
        } else if (line.lineType === 'CUSTOMER_CHARGE') {
          await transaction.execute(sql`
            insert into app.customer_ledger_entries (id, tenant_id, customer_id, account_id, account_type, entry_type, direction, amount, source_type, source_id, source_key, occurred_at, business_date, note, reason, actor_membership_id)
            values (${randomUUID()}, ${context.tenantId}, ${line.customerId}, ${line.accountId}, 'CREDIT', 'CREDIT_FUEL_CHARGE', 'INCREASE', ${line.amount}, 'OPENING_BALANCE', ${line.id}, ${`opening-balance:customer:${line.accountId}:${line.reference}`}, ${effectiveAt}, ${line.effectiveDate}, ${`Opening charge ${line.reference}`}, ${line.notes}, ${context.authority.membership.membershipId})
          `);
        } else if (line.lineType === 'CASH_BALANCE') {
          await transaction.execute(sql`
            insert into app.cash_movements (id, tenant_id, station_id, movement_type, amount, currency, from_location_id, to_location_id, source_type, source_id, business_date, effective_at, reason, actor_membership_id)
            values (${randomUUID()}, ${context.tenantId}, ${line.stationId}, 'ADJUSTMENT_IN', ${line.amount}, 'USD', null, ${line.cashLocationId}, 'OPENING_BALANCE', ${line.id}, ${line.effectiveDate}, ${effectiveAt}, ${line.notes ?? 'Opening cash balance'}, ${context.authority.membership.membershipId})
          `);
        } else if (line.lineType === 'BANK_BALANCE') {
          await transaction.insert(bankOpeningBalances).values({
            id: randomUUID(),
            tenantId: context.tenantId,
            legalEntityId: line.legalEntityId!,
            bankAccountId: line.bankAccountId!,
            amount: line.amount!,
            currency: 'USD',
            effectiveDate: line.effectiveDate,
            sourceBatchId: input.batchId,
            sourceLineId: line.id,
            actorMembershipId: context.authority.membership.membershipId,
          });
        } else if (line.lineType === 'TANK_STOCK') {
          await transaction.insert(inventoryMovements).values({
            id: randomUUID(),
            tenantId: context.tenantId,
            stationId: line.stationId!,
            tankId: line.tankId!,
            productId: line.productId!,
            movementType: 'OPENING_BALANCE',
            quantityLitres: line.quantityLitres!,
            effectiveAt,
            businessDate: line.effectiveDate,
            sourceType: 'OPENING_BALANCE',
            sourceId: line.id,
            actorMembershipId: context.authority.membership.membershipId,
          });
          if (line.inventoryValue)
            await postOpeningInventoryCostInTransaction(transaction, {
              tenantId: context.tenantId,
              stationId: line.stationId!,
              tankId: line.tankId!,
              amount: line.inventoryValue,
              currency: 'USD',
              actorMembershipId: context.authority.membership.membershipId,
            });
          else {
            const persistedHistoricalProjection =
              await persistHistoricalLateSourceUnvaluedProjectionInTransaction(transaction, {
                tenantId: context.tenantId,
                stationId: line.stationId!,
                tankId: line.tankId!,
                productId: line.productId!,
                sourceType: 'OPENING_BALANCE',
                sourceId: line.id,
              });
            if (!persistedHistoricalProjection) {
              await persistInventoryCostProjectionInTransaction(transaction, {
                tenantId: context.tenantId,
                stationId: line.stationId!,
                tankId: line.tankId!,
                productId: line.productId!,
              });
            }
          }
        }
      }
      await transaction.execute(
        sql`update app.opening_balance_batches set state = 'LOCKED', locked_by = ${context.authority.membership.membershipId}, locked_at = now(), version = version + 1, updated_at = now() where tenant_id = ${context.tenantId} and id = ${input.batchId} and version = ${input.expectedVersion}`,
      );
      return {
        batchId: input.batchId,
        state: 'LOCKED' as const,
        version: input.expectedVersion + 1,
        postedLineCount: lines.length,
      };
    },
  });
}

export const OPENING_BALANCE_COMMAND_TYPES = [
  'PreviewOpeningBalanceImport',
  'CreateOpeningBalanceBatch',
  'ApproveOpeningBalanceBatch',
  'LockOpeningBalanceBatch',
] as const;
