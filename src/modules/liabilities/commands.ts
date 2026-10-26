import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import { ExactDecimal } from '../../platform/domain/primitives';
import {
  executeLiabilityCommand,
  liabilityRequestHash,
  resolveLiabilityCommandContext,
  type LiabilityCommandContext,
  type LiabilityTransaction,
} from './application';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form.');
const money = z
  .string()
  .regex(/^\d+(?:\.\d{1,4})?$/, 'Use a positive amount with up to four decimals.')
  .refine((value) => new ExactDecimal(value).value.gt(0), 'The amount must be greater than zero.');

const recordSchema = z.object({
  commandType: z.literal('RecordApprovedLiability'),
  tenantId: uuid,
  legalEntityId: uuid,
  stationId: uuid.optional(),
  liabilityKind: z.enum(['TRANSPORTER', 'OTHER']),
  counterpartyName: z.string().trim().min(1).max(200),
  reference: z.string().trim().min(1).max(120),
  amount: money,
  effectiveDate: date,
  dueDate: date.optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

const adjustSchema = z.object({
  commandType: z.enum(['AdjustApprovedLiability', 'ReverseApprovedLiability']),
  tenantId: uuid,
  legalEntityId: uuid,
  stationId: uuid.optional(),
  liabilityAccountId: uuid,
  originalEntryId: uuid,
  amount: money,
  effectiveDate: date,
  reason: z.string().trim().min(1).max(500),
});

function idempotencyKey(request: Request): string {
  return request.headers.get('idempotency-key')?.trim() ?? '';
}

function assertDateOrder(effectiveDate: string, dueDate?: string): void {
  if (dueDate && dueDate < effectiveDate) {
    throw new AppError('VALIDATION_FAILED', 'The due date cannot be before the liability date.');
  }
}

async function balanceForAccount(
  transaction: LiabilityTransaction,
  context: LiabilityCommandContext,
  accountId: string,
): Promise<string> {
  const rows = await transaction.execute<{ balance: string }>(sql`
    select coalesce(sum(case when direction = 'INCREASE' then amount else -amount end), 0)::text as balance
    from app.approved_liability_entries
    where tenant_id = ${context.tenantId}
      and legal_entity_id = ${context.legalEntityId}
      and liability_account_id = ${accountId}
  `);
  return rows[0]?.balance ?? '0';
}

async function insertEntry(
  transaction: LiabilityTransaction,
  context: LiabilityCommandContext,
  input: {
    id: string;
    accountId: string;
    originalEntryId: string | null;
    liabilityKind: 'TRANSPORTER' | 'OTHER';
    entryType: 'RECOGNITION' | 'ADJUSTMENT' | 'REVERSAL';
    direction: 'INCREASE' | 'DECREASE';
    counterpartyName: string;
    reference: string;
    amount: string;
    effectiveDate: string;
    dueDate?: string;
    reason?: string;
  },
) {
  await transaction.execute(sql`
    insert into app.approved_liability_entries (
      id, tenant_id, legal_entity_id, station_id, liability_account_id, original_entry_id,
      liability_kind, entry_type, direction, counterparty_name, reference, amount, currency,
      effective_date, due_date, reason, actor_membership_id
    ) values (
      ${input.id}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId ?? null},
      ${input.accountId}, ${input.originalEntryId}, ${input.liabilityKind}, ${input.entryType},
      ${input.direction}, ${input.counterpartyName}, ${input.reference}, ${input.amount}, 'USD',
      ${input.effectiveDate}, ${input.dueDate ?? null}, ${input.reason ?? null},
      ${context.authority.membership.membershipId}
    )
  `);
}

export async function recordApprovedLiabilityFromRequest(request: Request, body: unknown) {
  const input = recordSchema.parse(body);
  assertDateOrder(input.effectiveDate, input.dueDate);
  const context = await resolveLiabilityCommandContext({ ...input, request });
  return executeLiabilityCommand({
    context,
    commandType: input.commandType,
    idempotencyKey: idempotencyKey(request),
    requestHash: liabilityRequestHash(input),
    actionCode: 'FINANCE.LIABILITY_RECORDED',
    subjectId: (result: { liabilityAccountId: string }) => result.liabilityAccountId,
    reason: input.reason,
    execute: async (transaction) => {
      const accountId = randomUUID();
      const entryId = randomUUID();
      await insertEntry(transaction, context, {
        id: entryId,
        accountId,
        originalEntryId: null,
        liabilityKind: input.liabilityKind,
        entryType: 'RECOGNITION',
        direction: 'INCREASE',
        counterpartyName: input.counterpartyName,
        reference: input.reference,
        amount: input.amount,
        effectiveDate: input.effectiveDate,
        dueDate: input.dueDate,
        reason: input.reason,
      });
      return { liabilityAccountId: accountId, entryId, balance: input.amount };
    },
  });
}

export async function adjustApprovedLiabilityFromRequest(request: Request, body: unknown) {
  const input = adjustSchema.parse(body);
  const context = await resolveLiabilityCommandContext({ ...input, request });
  return executeLiabilityCommand({
    context,
    commandType: input.commandType,
    idempotencyKey: idempotencyKey(request),
    requestHash: liabilityRequestHash(input),
    actionCode:
      input.commandType === 'ReverseApprovedLiability'
        ? 'FINANCE.LIABILITY_REVERSED'
        : 'FINANCE.LIABILITY_ADJUSTED',
    subjectId: (result: { liabilityAccountId: string }) => result.liabilityAccountId,
    reason: input.reason,
    execute: async (transaction) => {
      const originals = await transaction.execute<{
        id: string;
        liability_account_id: string;
        liability_kind: 'TRANSPORTER' | 'OTHER';
        counterparty_name: string;
        reference: string;
        due_date: string | null;
        station_id: string | null;
      }>(sql`
        select id, liability_account_id, liability_kind, counterparty_name, reference, due_date, station_id
        from app.approved_liability_entries
        where tenant_id = ${context.tenantId}
          and legal_entity_id = ${context.legalEntityId}
          and id = ${input.originalEntryId}
          and liability_account_id = ${input.liabilityAccountId}
        limit 1
      `);
      const original = originals[0];
      if (!original) throw new AppError('NOT_FOUND', 'The approved liability entry was not found.');
      if (context.stationId && original.station_id !== context.stationId) {
        throw new AppError('FORBIDDEN', 'The liability entry is outside the selected station.');
      }
      const current = await balanceForAccount(transaction, context, input.liabilityAccountId);
      const currentValue = new ExactDecimal(current).value;
      const amountValue = new ExactDecimal(input.amount).value;
      if (input.commandType === 'ReverseApprovedLiability' && !currentValue.gt(0)) {
        throw new AppError(
          'CONFLICT',
          'This liability has already been fully settled or reversed.',
        );
      }
      if (input.commandType === 'ReverseApprovedLiability' && !amountValue.eq(currentValue)) {
        throw new AppError(
          'VALIDATION_FAILED',
          'A reversal must reverse the remaining liability amount.',
        );
      }
      if (amountValue.gt(currentValue)) {
        throw new AppError(
          'VALIDATION_FAILED',
          'An adjustment cannot reduce a liability below zero.',
        );
      }
      const remaining = currentValue.sub(amountValue).toFixed();
      const entryId = randomUUID();
      await insertEntry(transaction, context, {
        id: entryId,
        accountId: input.liabilityAccountId,
        originalEntryId: input.originalEntryId,
        liabilityKind: original.liability_kind,
        entryType: input.commandType === 'ReverseApprovedLiability' ? 'REVERSAL' : 'ADJUSTMENT',
        direction: 'DECREASE',
        counterpartyName: original.counterparty_name,
        reference: `${original.reference}:${entryId}`,
        amount: input.amount,
        effectiveDate: input.effectiveDate,
        dueDate: original.due_date ?? undefined,
        reason: input.reason,
      });
      return {
        liabilityAccountId: input.liabilityAccountId,
        entryId,
        balance: remaining,
      };
    },
  });
}
