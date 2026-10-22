import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { memberships, stations } from './a1';

/**
 * Private files (invoices, delivery notes, deposit slips, photos) kept against one record at one
 * station. Append-only: a file is never changed or removed, only added.
 */
export const documents = appSchema.table(
  'documents',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    stationId: uuid('station_id').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    kind: text('kind').notNull(),
    objectKey: text('object_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    uploadedBy: uuid('uploaded_by').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('documents_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('documents_tenant_object_key_uidx').on(table.tenantId, table.objectKey),
    index('documents_subject_idx').on(
      table.tenantId,
      table.stationId,
      table.subjectType,
      table.subjectId,
    ),
    check(
      'documents_subject_type_ck',
      sql`${table.subjectType} in ('FUEL_DELIVERY','BANK_DEPOSIT','CASH_HANDOVER','RECONCILIATION','EXPENSE')`,
    ),
    check(
      'documents_kind_ck',
      sql`${table.kind} in ('INVOICE','DELIVERY_NOTE','DEPOSIT_SLIP','RECEIPT','PHOTO','OTHER')`,
    ),
    check('documents_filename_nonempty_ck', sql`btrim(${table.fileName}) <> ''`),
    check(
      'documents_content_type_ck',
      sql`${table.contentType} in (
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )`,
    ),
    check('documents_byte_size_ck', sql`${table.byteSize} > 0 and ${table.byteSize} <= 10485760`),
    check('documents_sha256_ck', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId, table.stationId],
      foreignColumns: [stations.tenantId, stations.legalEntityId, stations.id],
      name: 'documents_station_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.uploadedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'documents_uploaded_by_fk',
    }),
  ],
);
