import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getAuditSigningKey } from '../../platform/config/env';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import { createLogger } from '../../platform/logging';
import {
  createR2Storage,
  createPrivateObjectKey,
  type PrivateObjectKey,
  type PrivateStorage,
} from '../../platform/storage';
import {
  authorize,
  type AccessScope,
  type AuthorizationActor,
  type PermissionCode,
} from '../../platform/security/permissions';
import { appendSecurityEvent } from '../audit/contracts';
import { resolveTenantReadAuthority } from '../context/read-authority';
import { resolveExpenseCommandContext } from './application';
import { resolveExpenseReadContext } from './read-context';

export const MAX_EXPENSE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const EXPENSE_ATTACHMENT_SIGNED_URL_SECONDS = 300;

export const EXPENSE_ATTACHMENT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

type ExpenseAttachmentContentType = (typeof EXPENSE_ATTACHMENT_CONTENT_TYPES)[number];

const logger = createLogger({ component: 'expenses.attachments' });
const uuid = z.string().uuid();

const extensionByContentType: Readonly<Record<ExpenseAttachmentContentType, readonly string[]>> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
};

export const expenseAttachmentListQuerySchema = z.object({
  tenantId: uuid,
  stationId: uuid,
  expenseId: uuid,
});

export const expenseAttachmentDownloadQuerySchema = z.object({
  tenantId: uuid,
});

export type ExpenseAttachmentUploadFile = Readonly<{
  name: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

export type ValidatedExpenseAttachment = Readonly<{
  fileName: string;
  contentType: ExpenseAttachmentContentType;
  body: Uint8Array;
  byteSize: number;
  sha256: string;
}>;

export type ExpenseAttachmentStorage = Pick<PrivateStorage, 'put' | 'delete' | 'createReadUrl'>;

export type ExpenseAttachmentDependencies = Readonly<{
  storage?: ExpenseAttachmentStorage;
  now?: () => Date;
}>;

function safeFileName(value: string): string {
  const basename = value.replaceAll('\\', '/').split('/').at(-1)?.trim() ?? '';
  if (!basename || basename.length > 255 || /[\u0000-\u001f\u007f]/.test(basename)) {
    throw new AppError('VALIDATION_FAILED', 'The attachment filename is invalid');
  }
  return basename;
}

function extensionOf(fileName: string): string | undefined {
  const value = fileName.toLowerCase();
  const dot = value.lastIndexOf('.');
  return dot >= 0 && dot < value.length - 1 ? value.slice(dot + 1) : undefined;
}

function assertContentType(value: string): asserts value is ExpenseAttachmentContentType {
  if (!(EXPENSE_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(value)) {
    throw new AppError('VALIDATION_FAILED', 'This attachment file type is not supported');
  }
}

function hasBytes(body: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  return bytes.every((byte, index) => body[offset + index] === byte);
}

function hasAscii(body: Uint8Array, value: string, offset = 0): boolean {
  return hasBytes(
    body,
    [...value].map((character) => character.charCodeAt(0)),
    offset,
  );
}

function assertContentSignature(type: ExpenseAttachmentContentType, body: Uint8Array): void {
  const matches =
    type === 'image/jpeg'
      ? hasBytes(body, [0xff, 0xd8, 0xff])
      : type === 'image/png'
        ? hasBytes(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        : type === 'image/gif'
          ? hasAscii(body, 'GIF87a') || hasAscii(body, 'GIF89a')
          : type === 'image/webp'
            ? hasAscii(body, 'RIFF') && hasAscii(body, 'WEBP', 8)
            : type === 'application/pdf'
              ? hasAscii(body, '%PDF-')
              : hasBytes(body, [0x50, 0x4b, 0x03, 0x04]);
  if (!matches) {
    throw new AppError('VALIDATION_FAILED', 'The attachment content does not match its file type');
  }
}

export function validateExpenseAttachmentFile(input: {
  name: string;
  type: string;
  body: Uint8Array;
}): ValidatedExpenseAttachment {
  const fileName = safeFileName(input.name);
  assertContentType(input.type);
  if (input.body.byteLength < 1 || input.body.byteLength > MAX_EXPENSE_ATTACHMENT_BYTES) {
    throw new AppError('VALIDATION_FAILED', 'Attachment files must be between 1 byte and 10 MB');
  }
  assertContentSignature(input.type, input.body);
  const extension = extensionOf(fileName);
  if (extension && !extensionByContentType[input.type].includes(extension)) {
    throw new AppError('VALIDATION_FAILED', 'The attachment filename does not match its file type');
  }
  return {
    fileName,
    contentType: input.type,
    body: input.body,
    byteSize: input.body.byteLength,
    sha256: createHash('sha256').update(input.body).digest('hex'),
  };
}

export function createExpenseAttachmentObjectKey(attachmentId: string): PrivateObjectKey {
  return createPrivateObjectKey('expense-attachments', attachmentId);
}

export function assertExpenseAttachmentAssociation(input: {
  requestedTenantId: string;
  requestedStationId: string;
  expense: { tenantId: string; stationId: string; legalEntityId: string } | undefined;
}): { legalEntityId: string } {
  if (
    !input.expense ||
    input.expense.tenantId !== input.requestedTenantId ||
    input.expense.stationId !== input.requestedStationId
  ) {
    throw new AppError('NOT_FOUND', 'The expense was not found at this station');
  }
  return { legalEntityId: input.expense.legalEntityId };
}

export function assertExpenseAttachmentPermission(input: {
  actor: AuthorizationActor;
  scope: AccessScope;
  permissionCode: PermissionCode;
}): void {
  authorize({
    actor: input.actor,
    permissionCode: input.permissionCode,
    requestedScope: input.scope,
  });
}

function authorizeAttachment(
  context: {
    authority: { authorization: AuthorizationActor };
    scope: AccessScope;
  },
  permissionCode: PermissionCode,
): void {
  assertExpenseAttachmentPermission({
    actor: context.authority.authorization,
    permissionCode,
    scope: context.scope,
  });
}

function parseUploadFile(value: FormDataEntryValue | null): ExpenseAttachmentUploadFile {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.name !== 'string' ||
    typeof value.type !== 'string' ||
    typeof value.arrayBuffer !== 'function'
  ) {
    throw new AppError('VALIDATION_FAILED', 'An attachment file is required');
  }
  return value as unknown as ExpenseAttachmentUploadFile;
}

function parseUploadFields(formData: FormData): {
  tenantId: string;
  stationId: string;
  expenseId: string;
} {
  const result = expenseAttachmentListQuerySchema.safeParse({
    tenantId: formData.get('tenantId'),
    stationId: formData.get('stationId'),
    expenseId: formData.get('expenseId'),
  });
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'The expense attachment target is invalid', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

type ExpenseAssociationRow = {
  tenant_id: string;
  legal_entity_id: string;
  station_id: string;
};

async function loadExpenseAssociation(
  context: Awaited<ReturnType<typeof resolveExpenseCommandContext>>,
  expenseId: string,
): Promise<{ legalEntityId: string }> {
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<ExpenseAssociationRow>(sql`
      select tenant_id, legal_entity_id, station_id
      from app.expenses
      where tenant_id = ${context.tenantId}
        and legal_entity_id = ${context.legalEntityId}
        and station_id = ${context.stationId}
        and id = ${expenseId}
      limit 1
    `);
    return assertExpenseAttachmentAssociation({
      requestedTenantId: context.tenantId,
      requestedStationId: context.stationId!,
      expense: rows[0]
        ? {
            tenantId: rows[0].tenant_id,
            stationId: rows[0].station_id,
            legalEntityId: rows[0].legal_entity_id,
          }
        : undefined,
    });
  });
}

export async function uploadExpenseAttachmentFromRequest(
  request: Request,
  formData: FormData,
  dependencies: ExpenseAttachmentDependencies = {},
) {
  const target = parseUploadFields(formData);
  const file = parseUploadFile(formData.get('file'));
  const body = new Uint8Array(await file.arrayBuffer());
  const validated = validateExpenseAttachmentFile({
    name: file.name,
    type: file.type,
    body,
  });
  const context = await resolveExpenseCommandContext({
    request,
    tenantId: target.tenantId,
    stationId: target.stationId,
  });
  authorizeAttachment(context, 'document.upload');
  const association = await loadExpenseAssociation(context, target.expenseId);
  const attachmentId = randomUUID();
  const objectKey = createExpenseAttachmentObjectKey(attachmentId);
  const storage = dependencies.storage ?? createR2Storage();

  await storage.put({ key: objectKey, body: validated.body, contentType: validated.contentType });
  try {
    const uploadedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    return await withTenantTransaction(context.authority.transaction, async (transaction) => {
      await transaction.execute(sql`
        insert into app.expense_attachments (
          id, tenant_id, legal_entity_id, station_id, expense_id, object_key,
          file_name, content_type, byte_size, sha256, uploaded_by, uploaded_at
        ) values (
          ${attachmentId}, ${context.tenantId}, ${association.legalEntityId}, ${target.stationId},
          ${target.expenseId}, ${objectKey}, ${validated.fileName}, ${validated.contentType},
          ${validated.byteSize}, ${validated.sha256}, ${context.authority.membership.membershipId},
          ${uploadedAt}
        )
      `);
      await appendSecurityEvent(
        {
          eventId: randomUUID(),
          tenantId: context.tenantId,
          membershipId: context.authority.membership.membershipId,
          actorId: context.authority.actor.identityId,
          actorType: 'HUMAN',
          actionCode: 'EXPENSE.ATTACHMENT_UPLOADED',
          subjectType: 'ExpenseAttachment',
          subjectId: attachmentId,
          requestId: context.requestId,
          occurredAt: uploadedAt,
          after: {
            expenseId: target.expenseId,
            stationId: target.stationId,
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
        attachmentId,
        expenseId: target.expenseId,
        stationId: target.stationId,
        fileName: validated.fileName,
        contentType: validated.contentType,
        byteSize: validated.byteSize,
        sha256: validated.sha256,
        uploadedAt,
      };
    });
  } catch (error) {
    try {
      await storage.delete(objectKey);
    } catch {
      logger.error('expense_attachment.orphan_cleanup_failed', {
        signal: 'attachment_orphan_cleanup_failure',
        requestId: context.requestId,
        tenantId: context.tenantId,
      });
    }
    throw error;
  }
}

type ExpenseAttachmentRow = {
  id: string;
  expense_id: string;
  station_id: string;
  file_name: string;
  content_type: ExpenseAttachmentContentType;
  byte_size: number;
  sha256: string;
  uploaded_at: string;
  object_key: PrivateObjectKey;
  legal_entity_id: string;
};

function attachmentMetadata(row: ExpenseAttachmentRow) {
  return {
    attachmentId: row.id,
    expenseId: row.expense_id,
    stationId: row.station_id,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    uploadedAt: row.uploaded_at,
  };
}

export async function listExpenseAttachmentsFromRequest(request: Request, rawInput: unknown) {
  const input = expenseAttachmentListQuerySchema.parse(rawInput);
  const context = await resolveExpenseReadContext({
    request,
    tenantId: input.tenantId,
    stationId: input.stationId,
  });
  authorizeAttachment(context, 'document.view');
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<ExpenseAttachmentRow>(sql`
      select id, expense_id, station_id, file_name, content_type, byte_size,
             sha256, uploaded_at::text as uploaded_at, object_key, legal_entity_id
      from app.expense_attachments
      where tenant_id = ${context.tenantId}
        and legal_entity_id = ${context.legalEntityId}
        and station_id = ${context.stationId}
        and expense_id = ${input.expenseId}
      order by uploaded_at, id
    `);
    if (rows.length === 0) {
      const expense = await transaction.execute(sql`
        select 1 from app.expenses
        where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
          and station_id = ${context.stationId} and id = ${input.expenseId}
        limit 1
      `);
      if (expense.length === 0) throw new AppError('NOT_FOUND', 'The expense was not found');
    }
    return { items: rows.map(attachmentMetadata) };
  });
}

export async function createExpenseAttachmentDownloadFromRequest(
  request: Request,
  attachmentId: string,
  rawInput: unknown,
  dependencies: ExpenseAttachmentDependencies = {},
) {
  const input = expenseAttachmentDownloadQuerySchema.parse(rawInput);
  const attachmentIdResult = uuid.safeParse(attachmentId);
  if (!attachmentIdResult.success) throw new AppError('NOT_FOUND', 'The attachment was not found');
  const { authority } = await resolveTenantReadAuthority({ request, tenantId: input.tenantId });
  const row = await withTenantTransaction(authority.transaction, async (transaction) => {
    const rows = await transaction.execute<ExpenseAttachmentRow>(sql`
      select id, expense_id, station_id, file_name, content_type, byte_size,
             sha256, uploaded_at::text as uploaded_at, object_key, legal_entity_id
      from app.expense_attachments
      where tenant_id = ${input.tenantId} and id = ${attachmentIdResult.data}
      limit 1
    `);
    const value = rows[0];
    if (!value) throw new AppError('NOT_FOUND', 'The attachment was not found');
    return value;
  });
  authorizeAttachment(
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
  const downloadUrl = await storage.createReadUrl(
    row.object_key,
    EXPENSE_ATTACHMENT_SIGNED_URL_SECONDS,
  );
  return {
    ...attachmentMetadata(row),
    downloadUrl,
    expiresInSeconds: EXPENSE_ATTACHMENT_SIGNED_URL_SECONDS,
  };
}
