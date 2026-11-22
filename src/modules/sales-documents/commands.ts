import 'server-only';

import { AppError } from '../../platform/errors';
import {
  executeSalesDocumentCommand,
  resolveSalesDocumentCommandContext,
  salesDocumentRequestHash,
  type SalesDocumentContext,
  type SalesDocumentTransaction,
} from './application';
import {
  SALES_DOCUMENT_COMMAND_SCHEMAS,
  SALES_DOCUMENT_COMMAND_TYPES,
  type SalesDocumentCommandInput,
  type SalesDocumentCommandType,
} from './contracts';
import {
  acceptQuotationInTransaction,
  convertQuotationToInvoiceInTransaction,
  issueSalesDocumentInTransaction,
  recordSalesReceiptInTransaction,
  saveSalesDocProfileInTransaction,
  saveSalesDocumentDraftInTransaction,
  voidSalesDocumentInTransaction,
} from './persistence';

type Handler<T extends SalesDocumentCommandType> = {
  subjectType: string;
  subjectId: (input: SalesDocumentCommandInput<T>, result: Record<string, unknown>) => string;
  reason?: (input: SalesDocumentCommandInput<T>) => string | undefined;
  created: boolean;
  run: (
    transaction: SalesDocumentTransaction,
    context: SalesDocumentContext,
    input: SalesDocumentCommandInput<T>,
  ) => Promise<Record<string, unknown>>;
};

const documentId = (_: unknown, result: Record<string, unknown>) => String(result.documentId);

const HANDLERS: { [T in SalesDocumentCommandType]: Handler<T> } = {
  SaveSalesDocProfile: {
    subjectType: 'SALES_DOC_PROFILE',
    subjectId: (_input, result) => String(result.profileId),
    created: false,
    run: saveSalesDocProfileInTransaction,
  },
  SaveSalesDocumentDraft: {
    subjectType: 'SALES_DOCUMENT',
    subjectId: documentId,
    created: true,
    run: saveSalesDocumentDraftInTransaction,
  },
  IssueSalesDocument: {
    subjectType: 'SALES_DOCUMENT',
    subjectId: documentId,
    created: false,
    run: issueSalesDocumentInTransaction,
  },
  VoidSalesDocument: {
    subjectType: 'SALES_DOCUMENT',
    subjectId: documentId,
    reason: (input) => input.reason,
    created: false,
    run: voidSalesDocumentInTransaction,
  },
  AcceptQuotation: {
    subjectType: 'SALES_DOCUMENT',
    subjectId: documentId,
    created: false,
    run: acceptQuotationInTransaction,
  },
  ConvertQuotationToInvoice: {
    subjectType: 'SALES_DOCUMENT',
    subjectId: documentId,
    created: true,
    run: convertQuotationToInvoiceInTransaction,
  },
  RecordSalesReceipt: {
    subjectType: 'SALES_DOCUMENT',
    subjectId: documentId,
    created: true,
    run: recordSalesReceiptInTransaction,
  },
};

function assertSalesDocumentCommandType(value: unknown): SalesDocumentCommandType {
  if (
    typeof value === 'string' &&
    (SALES_DOCUMENT_COMMAND_TYPES as readonly string[]).includes(value)
  ) {
    return value as SalesDocumentCommandType;
  }
  throw new AppError('VALIDATION_FAILED', 'Unknown sales document command');
}

export async function executeSalesDocumentCommandFromRequest(
  request: Request,
  body: unknown,
): Promise<{ status: 200 | 201; body: Record<string, unknown> }> {
  const commandType = assertSalesDocumentCommandType(
    typeof body === 'object' && body !== null && 'commandType' in body
      ? (body as { commandType: unknown }).commandType
      : undefined,
  );
  const parsed = SALES_DOCUMENT_COMMAND_SCHEMAS[commandType].safeParse(body);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'The document command is invalid', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  const input = parsed.data as never as SalesDocumentCommandInput<SalesDocumentCommandType> & {
    tenantId: string;
    legalEntityId: string;
  };
  const handler = HANDLERS[commandType] as unknown as Handler<SalesDocumentCommandType>;
  const context = await resolveSalesDocumentCommandContext({
    request,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  const result = await executeSalesDocumentCommand<Record<string, unknown>>({
    context,
    commandType,
    idempotencyKey: request.headers.get('idempotency-key') ?? '',
    requestHash: salesDocumentRequestHash(input),
    audit: {
      subjectType: handler.subjectType,
      subjectId: (value) => handler.subjectId(input as never, value),
      reason: handler.reason?.(input as never),
    },
    execute: (transaction) => handler.run(transaction, context, input as never),
  });
  return { status: handler.created ? 201 : 200, body: result };
}
