import 'server-only';

import { AppError } from '../../platform/errors';
import {
  executePurchasingCommand,
  purchasingRequestHash,
  resolvePurchasingCommandContext,
  type PurchasingCommandContext,
  type PurchasingTransaction,
} from './application';
import {
  PURCHASING_COMMAND_SCHEMAS,
  PURCHASING_COMMAND_TYPES,
  type PurchasingCommandInput,
  type PurchasingCommandType,
} from './contracts';
import {
  amendPurchaseOrderInTransaction,
  approvePurchaseOrderInTransaction,
  cancelPurchaseOrderInTransaction,
  closePurchaseOrderInTransaction,
  createPurchaseOrderInTransaction,
  linkDeliveryToPurchaseOrderInTransaction,
  submitPurchaseOrderInTransaction,
  unlinkDeliveryFromPurchaseOrderInTransaction,
} from './persistence';

export function assertPurchasingCommandType(value: unknown): PurchasingCommandType {
  if (typeof value === 'string' && (PURCHASING_COMMAND_TYPES as string[]).includes(value)) {
    return value as PurchasingCommandType;
  }
  throw new AppError('VALIDATION_FAILED', 'Unsupported purchasing command type');
}

type Handler<T extends PurchasingCommandType> = {
  subjectType: string;
  subjectId: (input: PurchasingCommandInput<T>, result: Record<string, unknown>) => string;
  reason?: (input: PurchasingCommandInput<T>) => string | undefined;
  /** HTTP status on first execution. */
  created: boolean;
  run: (
    transaction: PurchasingTransaction,
    context: PurchasingCommandContext,
    input: PurchasingCommandInput<T>,
  ) => Promise<Record<string, unknown>>;
};

const orderId = (input: { purchaseOrderId: string }) => input.purchaseOrderId;

const HANDLERS: { [K in PurchasingCommandType]: Handler<K> } = {
  CreatePurchaseOrder: {
    subjectType: 'PurchaseOrder',
    subjectId: (_, result) => String(result.purchaseOrderId ?? ''),
    created: true,
    run: createPurchaseOrderInTransaction,
  },
  SubmitPurchaseOrder: {
    subjectType: 'PurchaseOrder',
    subjectId: orderId,
    created: false,
    run: submitPurchaseOrderInTransaction,
  },
  ApprovePurchaseOrder: {
    subjectType: 'PurchaseOrder',
    subjectId: orderId,
    reason: (input) => input.selfApprovalReason,
    created: false,
    run: approvePurchaseOrderInTransaction,
  },
  AmendPurchaseOrder: {
    subjectType: 'PurchaseOrder',
    subjectId: orderId,
    reason: (input) => input.reason,
    created: false,
    run: amendPurchaseOrderInTransaction,
  },
  CancelPurchaseOrder: {
    subjectType: 'PurchaseOrder',
    subjectId: orderId,
    reason: (input) => input.reason,
    created: false,
    run: cancelPurchaseOrderInTransaction,
  },
  ClosePurchaseOrder: {
    subjectType: 'PurchaseOrder',
    subjectId: orderId,
    reason: (input) => input.reason,
    created: false,
    run: closePurchaseOrderInTransaction,
  },
  LinkDeliveryToPurchaseOrder: {
    subjectType: 'PurchaseOrder',
    subjectId: orderId,
    created: true,
    run: linkDeliveryToPurchaseOrderInTransaction,
  },
  UnlinkDeliveryFromPurchaseOrder: {
    subjectType: 'PurchaseOrder',
    subjectId: orderId,
    reason: (input) => input.reason,
    created: false,
    run: unlinkDeliveryFromPurchaseOrderInTransaction,
  },
};

/** Validate, authorize, and execute one named purchasing command with idempotency and audit. */
export async function executePurchasingCommandFromRequest(
  request: Request,
  body: unknown,
): Promise<{ status: 200 | 201; body: Record<string, unknown> }> {
  const commandType = assertPurchasingCommandType(
    typeof body === 'object' && body !== null && 'commandType' in body
      ? (body as { commandType: unknown }).commandType
      : undefined,
  );
  const parsed = PURCHASING_COMMAND_SCHEMAS[commandType].safeParse(body);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'The purchasing command is invalid', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  // Each schema has been validated for this exact command type above.
  const input = parsed.data as never as PurchasingCommandInput<PurchasingCommandType> & {
    tenantId: string;
    stationId: string;
  };
  const handler = HANDLERS[commandType] as unknown as Handler<PurchasingCommandType>;
  const context = await resolvePurchasingCommandContext({
    request,
    tenantId: input.tenantId,
    stationId: input.stationId,
  });
  const result = await executePurchasingCommand<Record<string, unknown>>({
    context,
    commandType,
    idempotencyKey: request.headers.get('idempotency-key') ?? '',
    requestHash: purchasingRequestHash(input),
    audit: {
      subjectType: handler.subjectType,
      subjectId: (value) => handler.subjectId(input as never, value),
      reason: handler.reason?.(input as never),
    },
    execute: (transaction) => handler.run(transaction, context, input as never),
  });
  return { status: handler.created ? 201 : 200, body: result };
}
