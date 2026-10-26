import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getAuditSigningKey } from '../../platform/config/env';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import {
  createPrivateObjectKey,
  createR2Storage,
  type PrivateObjectKey,
  type PrivateStorage,
} from '../../platform/storage';
import { appendSecurityEvent } from '../audit/contracts';
import { validateExpenseAttachmentFile } from '../expenses/attachments';
import { authorizeSupplierCommand, resolveSupplierCommandContext } from './application';

export const SUPPLIER_PAYMENT_PROOF_SIGNED_URL_SECONDS = 300;

export type SupplierPaymentProofStorage = Pick<PrivateStorage, 'put' | 'delete' | 'createReadUrl'>;
export type SupplierPaymentProofDependencies = Readonly<{
  storage?: SupplierPaymentProofStorage;
  now?: () => Date;
}>;

const uuid = z.string().uuid();
const targetSchema = z.object({ tenantId: uuid, legalEntityId: uuid });

type UploadFile = Readonly<{
  name: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

type ProofRow = {
  id: string;
  subject_id: string;
  kind: 'PAYMENT_PROOF';
  legal_entity_id: string;
  file_name: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  uploaded_at: string;
  uploaded_by_name: string | null;
  object_key: PrivateObjectKey;
};

function parseFile(value: FormDataEntryValue | null): UploadFile {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.name !== 'string' ||
    typeof value.type !== 'string' ||
    typeof value.arrayBuffer !== 'function'
  ) {
    throw new AppError('VALIDATION_FAILED', 'A proof-of-payment file is required');
  }
  return value as unknown as UploadFile;
}

function parseTarget(formData: FormData): { tenantId: string; legalEntityId: string } {
  const result = targetSchema.safeParse({
    tenantId: formData.get('tenantId'),
    legalEntityId: formData.get('legalEntityId'),
  });
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'The supplier payment proof target is invalid', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

function paymentIdOrNotFound(paymentId: string): string {
  const parsed = uuid.safeParse(paymentId);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'The supplier payment was not found');
  return parsed.data;
}

function documentIdOrNotFound(documentId: string): string {
  const parsed = uuid.safeParse(documentId);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'The supplier payment proof was not found');
  return parsed.data;
}

function metadata(row: ProofRow) {
  return {
    documentId: row.id,
    subjectType: 'SUPPLIER_PAYMENT' as const,
    subjectId: row.subject_id,
    kind: row.kind,
    stationId: null,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    uploadedAt: row.uploaded_at,
    uploadedByName: row.uploaded_by_name,
  };
}

async function assertPaymentExists(
  context: Awaited<ReturnType<typeof resolveSupplierCommandContext>>,
  paymentId: string,
): Promise<void> {
  await withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{ id: string }>(sql`
      select id
      from app.supplier_payments
      where tenant_id = ${context.tenantId}
        and legal_entity_id = ${context.legalEntityId}
        and id = ${paymentId}
      limit 1
    `);
    if (!rows[0]) throw new AppError('NOT_FOUND', 'The supplier payment was not found');
  });
}

export async function uploadSupplierPaymentProofFromRequest(
  request: Request,
  paymentId: string,
  formData: FormData,
  dependencies: SupplierPaymentProofDependencies = {},
) {
  const target = parseTarget(formData);
  const parsedPaymentId = paymentIdOrNotFound(paymentId);
  const file = parseFile(formData.get('file'));
  const validated = validateExpenseAttachmentFile({
    name: file.name,
    type: file.type,
    body: new Uint8Array(await file.arrayBuffer()),
  });
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: target.tenantId,
    legalEntityId: target.legalEntityId,
  });
  authorizeSupplierCommand(context, 'supplier.payment.create');
  await assertPaymentExists(context, parsedPaymentId);

  const documentId = randomUUID();
  const objectKey = createPrivateObjectKey('documents', documentId);
  const storage = dependencies.storage ?? createR2Storage();
  await storage.put({ key: objectKey, body: validated.body, contentType: validated.contentType });
  try {
    const uploadedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    return await withTenantTransaction(context.authority.transaction, async (transaction) => {
      await transaction.execute(sql`
        insert into app.documents (
          id, tenant_id, legal_entity_id, station_id, subject_type, subject_id, kind,
          object_key, file_name, content_type, byte_size, sha256, uploaded_by, uploaded_at
        ) values (
          ${documentId}, ${context.tenantId}, ${context.legalEntityId}, null,
          'SUPPLIER_PAYMENT', ${parsedPaymentId}, 'PAYMENT_PROOF', ${objectKey},
          ${validated.fileName}, ${validated.contentType}, ${validated.byteSize}, ${validated.sha256},
          ${context.authority.membership.membershipId}, ${uploadedAt}
        )
      `);
      await appendSecurityEvent(
        {
          eventId: randomUUID(),
          tenantId: context.tenantId,
          membershipId: context.authority.membership.membershipId,
          actorId: context.authority.actor.identityId,
          actorType: 'HUMAN',
          actionCode: 'SUPPLIER.PAYMENT_PROOF_UPLOADED',
          subjectType: 'SupplierPaymentProof',
          subjectId: documentId,
          requestId: context.requestId,
          occurredAt: uploadedAt,
          after: {
            paymentId: parsedPaymentId,
            legalEntityId: context.legalEntityId,
            kind: 'PAYMENT_PROOF',
            fileName: validated.fileName,
            contentType: validated.contentType,
            byteSize: validated.byteSize,
            sha256: validated.sha256,
          },
        },
        getAuditSigningKey(),
        transaction,
      );
      return {
        ...metadata({
          id: documentId,
          subject_id: parsedPaymentId,
          kind: 'PAYMENT_PROOF',
          legal_entity_id: context.legalEntityId,
          file_name: validated.fileName,
          content_type: validated.contentType,
          byte_size: validated.byteSize,
          sha256: validated.sha256,
          uploaded_at: uploadedAt,
          uploaded_by_name: null,
          object_key: objectKey,
        }),
      };
    });
  } catch (error) {
    try {
      await storage.delete(objectKey);
    } catch {
      // The database error is the useful failure; the orphan is recoverable through the storage
      // reconciliation process and is never exposed to callers.
    }
    throw error;
  }
}

export async function listSupplierPaymentProofsFromRequest(
  request: Request,
  paymentId: string,
  rawInput: unknown,
) {
  const input = targetSchema.parse(rawInput);
  const parsedPaymentId = paymentIdOrNotFound(paymentId);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  authorizeSupplierCommand(context, 'supplier.creditor.review');
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<ProofRow>(sql`
      select d.id, d.subject_id, d.kind, d.legal_entity_id, d.file_name, d.content_type,
             d.byte_size, d.sha256, d.uploaded_at::text as uploaded_at,
             coalesce(nullif(u.name, ''), u.email) as uploaded_by_name, d.object_key
      from app.documents d
      left join app.memberships m on m.tenant_id = d.tenant_id and m.id = d.uploaded_by
      left join app.users u on u.id = m.identity_id
      where d.tenant_id = ${context.tenantId}
        and d.legal_entity_id = ${context.legalEntityId}
        and d.station_id is null
        and d.subject_type = 'SUPPLIER_PAYMENT'
        and d.subject_id = ${parsedPaymentId}
      order by d.uploaded_at, d.id
    `);
    if (rows.length === 0) await assertPaymentExists(context, parsedPaymentId);
    return { items: rows.map(metadata) };
  });
}

export async function createSupplierPaymentProofDownloadFromRequest(
  request: Request,
  paymentId: string,
  documentId: string,
  rawInput: unknown,
  dependencies: SupplierPaymentProofDependencies = {},
) {
  const input = targetSchema.parse(rawInput);
  const parsedPaymentId = paymentIdOrNotFound(paymentId);
  const parsedDocumentId = documentIdOrNotFound(documentId);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  authorizeSupplierCommand(context, 'supplier.creditor.review');
  const row = await withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<ProofRow>(sql`
      select d.id, d.subject_id, d.kind, d.legal_entity_id, d.file_name, d.content_type,
             d.byte_size, d.sha256, d.uploaded_at::text as uploaded_at,
             null::text as uploaded_by_name, d.object_key
      from app.documents d
      where d.tenant_id = ${context.tenantId}
        and d.legal_entity_id = ${context.legalEntityId}
        and d.station_id is null
        and d.subject_type = 'SUPPLIER_PAYMENT'
        and d.subject_id = ${parsedPaymentId}
        and d.id = ${parsedDocumentId}
      limit 1
    `);
    if (!rows[0]) throw new AppError('NOT_FOUND', 'The supplier payment proof was not found');
    return rows[0];
  });
  const storage = dependencies.storage ?? createR2Storage();
  const downloadUrl = await storage.createReadUrl(
    row.object_key,
    SUPPLIER_PAYMENT_PROOF_SIGNED_URL_SECONDS,
  );
  return {
    ...metadata(row),
    downloadUrl,
    expiresInSeconds: SUPPLIER_PAYMENT_PROOF_SIGNED_URL_SECONDS,
  };
}
