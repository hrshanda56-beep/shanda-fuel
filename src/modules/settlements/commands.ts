import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import {
  executeSettlementCommand,
  requestHash,
  resolveSettlementCommandContext,
} from './application';
import {
  allocateProviderSettlementInTransaction,
  configureProviderAccountInTransaction,
  createPaymentProviderInTransaction,
  recordProviderSettlementInTransaction,
  reconcileProviderSettlementInTransaction,
  reverseProviderSettlementAllocationInTransaction,
} from './persistence';

const decimalString = z.string().regex(/^\d+(?:\.\d+)?$/, 'Expected a decimal string');
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const metadata = z.record(z.string(), z.unknown()).default({});

const providerType = z.enum(['CARD_ACQUIRER', 'POS', 'MOBILE_MONEY', 'OTHER_ELECTRONIC']);

const createProviderSchema = z.object({
  commandType: z.literal('CreatePaymentProvider'),
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  providerType,
  metadata,
});

const configureAccountSchema = z.object({
  commandType: z.literal('ConfigureProviderAccount'),
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  providerId: z.string().uuid(),
  accountReference: z.string().trim().min(1).max(160),
  displayName: z.string().trim().min(1).max(160),
  currency: z.string().regex(/^[A-Z]{3}$/),
  accountStationId: z.string().uuid().nullable().optional(),
  legalEntityId: z.string().uuid().nullable().optional(),
  metadata,
});

const createBankAccountSchema = z.object({
  commandType: z.literal('CreateBankAccount'),
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  legalEntityId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  bankName: z.string().trim().min(1).max(160),
  accountReferenceMasked: z.string().trim().min(1).max(160),
  currency: z.literal('USD').optional(),
});

const recordBankBalanceSchema = z.object({
  commandType: z.literal('RecordBankBalance'),
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  /** The date the bank statement shows this balance for. */
  asOfDate: dateString,
  /** May be negative for an overdrawn account. */
  amount: z
    .string()
    .regex(/^-?\d+(?:\.\d{1,4})?$/, 'Enter the balance as an amount, for example 12500.50'),
  note: z.string().trim().max(500).optional(),
});

const recordSettlementSchema = z.object({
  commandType: z.literal('RecordProviderSettlement'),
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  providerAccountId: z.string().uuid(),
  settlementReference: z.string().trim().min(1).max(160),
  batchReference: z.string().trim().max(160).nullable().optional(),
  transactionDate: dateString,
  settlementDate: dateString,
  currency: z.string().regex(/^[A-Z]{3}$/),
  grossAmount: decimalString,
  providerFeeAmount: decimalString.nullable().optional(),
  providerDeductionAmount: decimalString.nullable().optional(),
  reportedNetAmount: decimalString.nullable().optional(),
  sourceType: z.enum(['MANUAL', 'PROVIDER_IMPORT']),
  sourceKey: z.string().trim().min(1).max(240),
  sourceMetadata: metadata,
});

const allocateSchema = z.object({
  commandType: z.literal('AllocateProviderSettlement'),
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  settlementId: z.string().uuid(),
  reconciliationPaymentId: z.string().uuid(),
  amount: decimalString,
  allocationKey: z.string().trim().min(1).max(240),
  expectedVersion: z.number().int().nonnegative(),
});

const reverseSchema = z.object({
  commandType: z.literal('ReverseProviderSettlementAllocation'),
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  allocationId: z.string().uuid(),
  reversalKey: z.string().trim().min(1).max(240),
  expectedVersion: z.number().int().nonnegative(),
});

const reconcileSchema = z.object({
  commandType: z.literal('ReconcileProviderSettlement'),
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  settlementId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().max(500).nullable().optional(),
});

function idempotencyKey(request: Request): string {
  return request.headers.get('idempotency-key') ?? '';
}

export async function createPaymentProviderFromRequest(request: Request, body: unknown) {
  const input = createProviderSchema.parse(body);
  const context = await resolveSettlementCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  const providerId = randomUUID();
  return executeSettlementCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'provider.manage',
    authorizeTenantScope: true,
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'PaymentProvider',
    subjectId: providerId,
    execute: async (transaction) => ({
      result: await createPaymentProviderInTransaction(transaction, context, {
        id: providerId,
        code: input.code,
        name: input.name,
        providerType: input.providerType,
        metadata: input.metadata,
      }),
      after: { providerId, code: input.code, providerType: input.providerType },
    }),
  });
}

export async function configureProviderAccountFromRequest(request: Request, body: unknown) {
  const input = configureAccountSchema.parse(body);
  const context = await resolveSettlementCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  const providerAccountId = randomUUID();
  return executeSettlementCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'provider.manage',
    authorizeTenantScope: true,
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'ProviderAccount',
    subjectId: providerAccountId,
    execute: async (transaction) => ({
      result: await configureProviderAccountInTransaction(transaction, context, {
        id: providerAccountId,
        providerId: input.providerId,
        accountReference: input.accountReference,
        displayName: input.displayName,
        currency: input.currency,
        stationId: input.accountStationId ?? null,
        legalEntityId: input.legalEntityId ?? null,
        metadata: input.metadata,
      }),
      after: { providerAccountId, providerId: input.providerId },
    }),
  });
}

export async function recordBankBalanceFromRequest(request: Request, body: unknown) {
  const input = recordBankBalanceSchema.parse(body);
  const context = await resolveSettlementCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  const balanceId = randomUUID();
  return executeSettlementCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'provider.manage',
    authorizeTenantScope: true,
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'BankAccount',
    subjectId: input.bankAccountId,
    execute: async (transaction) => {
      const today = new Date().toISOString().slice(0, 10);
      if (input.asOfDate > today) {
        throw new AppError('VALIDATION_FAILED', 'A bank balance cannot be dated in the future.');
      }
      const account = await transaction.execute<{ id: string }>(sql`
        select id from app.bank_accounts
        where tenant_id = ${context.tenantId} and id = ${input.bankAccountId} and status = 'ACTIVE'
      `);
      if (!account[0]) throw new AppError('NOT_FOUND', 'That bank account was not found.');
      await transaction.execute(sql`
        insert into app.bank_account_balances
          (id, tenant_id, bank_account_id, as_of_date, amount, note, recorded_by)
        values
          (${balanceId}, ${context.tenantId}, ${input.bankAccountId}, ${input.asOfDate},
           ${input.amount}, ${input.note || null}, ${context.authority.membership.membershipId})
      `);
      return {
        result: { balanceId, bankAccountId: input.bankAccountId, asOfDate: input.asOfDate },
        after: { amount: input.amount, asOfDate: input.asOfDate },
      };
    },
  });
}

export async function createBankAccountFromRequest(request: Request, body: unknown) {
  const input = createBankAccountSchema.parse(body);
  const context = await resolveSettlementCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  const bankAccountId = randomUUID();
  return executeSettlementCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'provider.manage',
    authorizeTenantScope: true,
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'BankAccount',
    subjectId: bankAccountId,
    execute: async (transaction) => {
      const legalEntity = await transaction.execute<{ id: string }>(sql`
        select le.id
        from app.legal_entities le
        join app.stations s
          on s.tenant_id = le.tenant_id and s.legal_entity_id = le.id
        where le.tenant_id = ${context.tenantId}
          and le.id = ${input.legalEntityId}
          and s.id = ${input.stationId}
        limit 1
      `);
      if (!legalEntity[0]) {
        throw new AppError('NOT_FOUND', 'The legal entity was not found for this organisation');
      }
      try {
        await transaction.execute(sql`
          insert into app.bank_accounts
            (id, tenant_id, legal_entity_id, name, bank_name, account_reference_masked, currency, status, version)
          values
            (${bankAccountId}, ${context.tenantId}, ${input.legalEntityId}, ${input.name},
             ${input.bankName}, ${input.accountReferenceMasked}, ${input.currency ?? 'USD'}, 'ACTIVE', 0)
        `);
      } catch (error) {
        const code = (error as { code?: string })?.code;
        const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
        if (code === '23505' || causeCode === '23505') {
          throw new AppError(
            'CONFLICT',
            'A bank account with this name already exists for the legal entity',
          );
        }
        throw error;
      }
      return {
        result: {
          bankAccountId,
          legalEntityId: input.legalEntityId,
          status: 'ACTIVE' as const,
        },
        after: {
          legalEntityId: input.legalEntityId,
          name: input.name,
          bankName: input.bankName,
          accountReferenceMasked: input.accountReferenceMasked,
          currency: input.currency ?? 'USD',
          status: 'ACTIVE',
        },
      };
    },
  });
}

export async function recordProviderSettlementFromRequest(request: Request, body: unknown) {
  const input = recordSettlementSchema.parse(body);
  const context = await resolveSettlementCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  const settlementId = randomUUID();
  return executeSettlementCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'provider.settlement.record',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'ProviderSettlement',
    subjectId: settlementId,
    execute: async (transaction) => ({
      result: await recordProviderSettlementInTransaction(transaction, context, {
        id: settlementId,
        providerAccountId: input.providerAccountId,
        settlementReference: input.settlementReference,
        batchReference: input.batchReference ?? null,
        transactionDate: input.transactionDate,
        settlementDate: input.settlementDate,
        currency: input.currency,
        grossAmount: input.grossAmount,
        providerFeeAmount: input.providerFeeAmount ?? null,
        providerDeductionAmount: input.providerDeductionAmount ?? null,
        reportedNetAmount: input.reportedNetAmount ?? null,
        sourceType: input.sourceType,
        sourceKey: input.sourceKey,
        sourceMetadata: input.sourceMetadata,
      }),
      after: { settlementId, settlementReference: input.settlementReference },
    }),
  });
}

export async function allocateProviderSettlementFromRequest(request: Request, body: unknown) {
  const input = allocateSchema.parse(body);
  const context = await resolveSettlementCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  const allocationId = randomUUID();
  return executeSettlementCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'provider.settlement.allocate',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'ProviderSettlementAllocation',
    subjectId: allocationId,
    execute: async (transaction) => ({
      result: await allocateProviderSettlementInTransaction(transaction, context, {
        id: allocationId,
        settlementId: input.settlementId,
        reconciliationPaymentId: input.reconciliationPaymentId,
        amount: input.amount,
        allocationKey: input.allocationKey,
        expectedVersion: input.expectedVersion,
      }),
      after: {
        settlementId: input.settlementId,
        reconciliationPaymentId: input.reconciliationPaymentId,
        amount: input.amount,
      },
    }),
  });
}

export async function reverseProviderSettlementAllocationFromRequest(
  request: Request,
  body: unknown,
) {
  const input = reverseSchema.parse(body);
  const context = await resolveSettlementCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  const reversalId = randomUUID();
  return executeSettlementCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'provider.settlement.reverse',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'ProviderSettlementAllocation',
    subjectId: reversalId,
    reason: 'Named provider settlement allocation reversal',
    execute: async (transaction) => ({
      result: await reverseProviderSettlementAllocationInTransaction(transaction, context, {
        id: reversalId,
        allocationId: input.allocationId,
        reversalKey: input.reversalKey,
        expectedVersion: input.expectedVersion,
      }),
      after: { reversalId, allocationId: input.allocationId },
    }),
  });
}

export async function reconcileProviderSettlementFromRequest(request: Request, body: unknown) {
  const input = reconcileSchema.parse(body);
  const context = await resolveSettlementCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeSettlementCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'provider.settlement.reconcile',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'ProviderSettlement',
    subjectId: input.settlementId,
    reason: input.reason ?? undefined,
    execute: async (transaction) => ({
      result: await reconcileProviderSettlementInTransaction(transaction, context, {
        settlementId: input.settlementId,
        expectedVersion: input.expectedVersion,
        reason: input.reason ?? null,
      }),
      after: { settlementId: input.settlementId, reason: input.reason ?? null },
    }),
  });
}

export function assertSettlementCommandType(
  value: unknown,
):
  | 'CreatePaymentProvider'
  | 'ConfigureProviderAccount'
  | 'CreateBankAccount'
  | 'RecordBankBalance'
  | 'RecordProviderSettlement'
  | 'AllocateProviderSettlement'
  | 'ReverseProviderSettlementAllocation'
  | 'ReconcileProviderSettlement' {
  if (
    value === 'CreatePaymentProvider' ||
    value === 'ConfigureProviderAccount' ||
    value === 'CreateBankAccount' ||
    value === 'RecordBankBalance' ||
    value === 'RecordProviderSettlement' ||
    value === 'AllocateProviderSettlement' ||
    value === 'ReverseProviderSettlementAllocation' ||
    value === 'ReconcileProviderSettlement'
  ) {
    return value;
  }
  throw new AppError('VALIDATION_FAILED', 'Unsupported settlement command type');
}
