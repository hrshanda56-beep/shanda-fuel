import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getAuditSigningKey } from '../../platform/config/env';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import { createLogger } from '../../platform/logging';
import { authorize, type PermissionCode } from '../../platform/security/permissions';
import {
  createR2Storage,
  createPrivateObjectKey,
  type PrivateObjectKey,
  type PrivateStorage,
} from '../../platform/storage';
import { appendSecurityEvent } from '../audit/contracts';
import { resolveTenantReadAuthority } from '../context/read-authority';
import { validateExpenseAttachmentFile } from '../expenses/attachments';
import {
  resolveInventoryCommandContext,
  type InventoryCommandContext,
} from '../inventory/application';
import {
  DOCUMENT_SIGNED_URL_SECONDS,
  DOCUMENT_SUBJECTS,
  isDocumentKind,
  isDocumentSubjectType,
  isEntityScopedSubject,
  type DocumentKind,
  type DocumentSubjectType,
} from './catalog';

/**
 * Private files kept against a record at one station: delivery notes, deposit slips, invoices,
 * photos. Files go to private object storage under a random key, never a name a person chose, and
 * are only reachable through a short-lived link created after the viewer's access is checked.
 * The file's type, size and real content are checked by the same validator the expense receipts use.
 */

const logger = createLogger({ component: 'documents' });
const uuid = z.string().uuid();

export type DocumentStorage = Pick<PrivateStorage, 'put' | 'delete' | 'createReadUrl'>;
export type DocumentDependencies = Readonly<{ storage?: DocumentStorage; now?: () => Date }>;

export const documentListQuerySchema = z.object({
  tenantId: uuid,
  stationId: uuid,
  subjectType: z.string().refine(isDocumentSubjectType, 'That kind of record cannot have files'),
  subjectId: uuid,
});

type DocumentRow = {
  id: string;
  subject_type: DocumentSubjectType;
  subject_id: string;
  kind: DocumentKind;
  station_id: string;
  legal_entity_id: string;
  file_name: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  uploaded_at: string;
  uploaded_by_name: string | null;
  object_key: PrivateObjectKey;
};

function metadata(row: DocumentRow) {
  return {
    documentId: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    kind: row.kind,
    stationId: row.station_id,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: row.byte_size,
    uploadedAt: row.uploaded_at,
    uploadedByName: row.uploaded_by_name,
  };
}

function authorizeDocument(
  context: Pick<InventoryCommandContext, 'authority' | 'scope'>,
  permissionCode: PermissionCode,
): void {
  authorize({
    actor: context.authority.authorization,
    permissionCode,
    requestedScope: context.scope,
  });
}

function parseUploadFile(value: FormDataEntryValue | null) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.name !== 'string' ||
    typeof value.type !== 'string' ||
    typeof value.arrayBuffer !== 'function'
  ) {
    throw new AppError('VALIDATION_FAILED', 'Choose a file to add');
  }
  return value as unknown as {
    name: string;
    type: string;
    arrayBuffer: () => Promise<ArrayBuffer>;
  };
}

function parseUploadFields(formData: FormData) {
  const result = documentListQuerySchema
    .extend({ kind: z.string().refine(isDocumentKind, 'Choose what kind of document it is') })
    .safeParse({
      tenantId: formData.get('tenantId'),
      stationId: formData.get('stationId'),
      subjectType: formData.get('subjectType'),
      subjectId: formData.get('subjectId'),
      kind: formData.get('kind'),
    });
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'The document details are not valid', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return {
    ...result.data,
    subjectType: result.data.subjectType as DocumentSubjectType,
    kind: result.data.kind as DocumentKind,
  };
}

/** The record must exist at this very station, in this organisation. */
async function assertSubjectExists(
  context: InventoryCommandContext,
  subjectType: DocumentSubjectType,
  subjectId: string,
): Promise<void> {
  // The table name comes only from the fixed catalog, never from the request.
  if (!isDocumentSubjectType(subjectType)) {
    throw new AppError('VALIDATION_FAILED', 'That kind of record cannot have files');
  }
  const table = sql.raw(`app.${DOCUMENT_SUBJECTS[subjectType].table}`);
  const rows = await withTenantTransaction(context.authority.transaction, (transaction) =>
    transaction.execute<{ id: string }>(sql`
      select id from ${table}
      where tenant_id = ${context.tenantId}
        ${
          isEntityScopedSubject(subjectType)
            ? sql`and legal_entity_id = ${context.legalEntityId}`
            : sql`and station_id = ${context.stationId}`
        }
        and id = ${subjectId}
      limit 1
    `),
  );
  if (!rows[0]) {
    throw new AppError(
      'NOT_FOUND',
      `That ${DOCUMENT_SUBJECTS[subjectType].label.toLowerCase()} was not found at this station`,
    );
  }
}

export async function uploadDocumentFromRequest(
  request: Request,
  formData: FormData,
  dependencies: DocumentDependencies = {},
) {
  const target = parseUploadFields(formData);
  const file = parseUploadFile(formData.get('file'));
  const validated = validateExpenseAttachmentFile({
    name: file.name,
    type: file.type,
    body: new Uint8Array(await file.arrayBuffer()),
  });
  const context = await resolveInventoryCommandContext({
    request,
    requestedTenantId: target.tenantId,
    stationId: target.stationId,
  });
  authorizeDocument(context, 'document.upload');
  await assertSubjectExists(context, target.subjectType, target.subjectId);

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
          ${documentId}, ${context.tenantId}, ${context.legalEntityId}, ${context.stationId},
          ${target.subjectType}, ${target.subjectId}, ${target.kind}, ${objectKey},
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
          actionCode: 'DOCUMENT.UPLOADED',
          subjectType: 'Document',
          subjectId: documentId,
          requestId: context.requestId,
          occurredAt: uploadedAt,
          after: {
            stationId: context.stationId,
            attachedTo: `${target.subjectType}:${target.subjectId}`,
            kind: target.kind,
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
        documentId,
        subjectType: target.subjectType,
        subjectId: target.subjectId,
        kind: target.kind,
        stationId: context.stationId,
        fileName: validated.fileName,
        contentType: validated.contentType,
        byteSize: validated.byteSize,
        uploadedAt,
      };
    });
  } catch (error) {
    try {
      await storage.delete(objectKey);
    } catch {
      logger.error('document.orphan_cleanup_failed', {
        signal: 'document_orphan_cleanup_failure',
        requestId: context.requestId,
        tenantId: context.tenantId,
      });
    }
    throw error;
  }
}

export async function listDocumentsFromRequest(request: Request, rawInput: unknown) {
  const input = documentListQuerySchema.parse(rawInput);
  const context = await resolveInventoryCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  authorizeDocument(context, 'document.view');
  const canUpload = (() => {
    try {
      authorizeDocument(context, 'document.upload');
      return true;
    } catch {
      return false;
    }
  })();
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<DocumentRow>(sql`
      select d.id, d.subject_type, d.subject_id, d.kind, d.station_id, d.legal_entity_id,
             d.file_name, d.content_type, d.byte_size, d.sha256, d.uploaded_at::text as uploaded_at,
             coalesce(nullif(u.name, ''), u.email) as uploaded_by_name, d.object_key
      from app.documents d
      left join app.memberships m on m.tenant_id = d.tenant_id and m.id = d.uploaded_by
      left join app.users u on u.id = m.identity_id
      where d.tenant_id = ${context.tenantId}
        ${
          isEntityScopedSubject(input.subjectType as DocumentSubjectType)
            ? sql`and d.legal_entity_id = ${context.legalEntityId}`
            : sql`and d.station_id = ${context.stationId}`
        }
        and d.subject_type = ${input.subjectType}
        and d.subject_id = ${input.subjectId}
      order by d.uploaded_at, d.id
    `);
    return { canUpload, items: rows.map(metadata) };
  });
}

export async function createDocumentDownloadFromRequest(
  request: Request,
  documentId: string,
  rawInput: unknown,
  dependencies: DocumentDependencies = {},
) {
  const input = z.object({ tenantId: uuid }).parse(rawInput);
  const parsedId = uuid.safeParse(documentId);
  if (!parsedId.success) throw new AppError('NOT_FOUND', 'The document was not found');
  const { authority } = await resolveTenantReadAuthority({ request, tenantId: input.tenantId });
  const row = await withTenantTransaction(authority.transaction, async (transaction) => {
    const rows = await transaction.execute<DocumentRow>(sql`
      select d.id, d.subject_type, d.subject_id, d.kind, d.station_id, d.legal_entity_id,
             d.file_name, d.content_type, d.byte_size, d.sha256, d.uploaded_at::text as uploaded_at,
             null::text as uploaded_by_name, d.object_key
      from app.documents d
      where d.tenant_id = ${input.tenantId} and d.id = ${parsedId.data}
      limit 1
    `);
    const value = rows[0];
    if (!value) throw new AppError('NOT_FOUND', 'The document was not found');
    return value;
  });
  authorizeDocument(
    {
      authority,
      scope: {
        tenantId: input.tenantId,
        scopeType: 'STATION',
        legalEntityId: row.legal_entity_id,
        stationId: row.station_id,
      },
    },
    'document.view',
  );
  const storage = dependencies.storage ?? createR2Storage();
  const downloadUrl = await storage.createReadUrl(row.object_key, DOCUMENT_SIGNED_URL_SECONDS);
  return { ...metadata(row), downloadUrl, expiresInSeconds: DOCUMENT_SIGNED_URL_SECONDS };
}
