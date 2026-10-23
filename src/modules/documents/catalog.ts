/**
 * What a document can be attached to and what kind of document it is. Pure data. Each subject
 * names the table that must hold the record at the same station, so a file can only ever be
 * attached to something that exists where the person is working.
 */
export const DOCUMENT_KINDS = [
  { value: 'INVOICE', label: 'Invoice' },
  { value: 'DELIVERY_NOTE', label: 'Delivery note' },
  { value: 'DEPOSIT_SLIP', label: 'Bank deposit slip' },
  { value: 'RECEIPT', label: 'Receipt' },
  { value: 'PHOTO', label: 'Photo' },
  { value: 'OTHER', label: 'Other' },
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]['value'];

export const DOCUMENT_SUBJECTS = {
  FUEL_DELIVERY: { table: 'fuel_deliveries', label: 'Fuel delivery' },
  BANK_DEPOSIT: { table: 'bank_deposits', label: 'Bank deposit' },
  CASH_HANDOVER: { table: 'cash_handovers', label: 'Cash handover' },
  RECONCILIATION: { table: 'reconciliations', label: 'Daily report' },
  EXPENSE: { table: 'expenses', label: 'Expense' },
  // A supplier payment belongs to a legal entity, not a station: the file is stored under the
  // station the person is working at, but is listed for the payment wherever it was added.
  SUPPLIER_PAYMENT: {
    table: 'supplier_payments',
    label: 'Supplier payment',
    entityScoped: true,
  },
} as const satisfies Record<string, { table: string; label: string; entityScoped?: boolean }>;

export type DocumentSubjectType = keyof typeof DOCUMENT_SUBJECTS;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_SIGNED_URL_SECONDS = 300;

export function isDocumentKind(value: unknown): value is DocumentKind {
  return DOCUMENT_KINDS.some((kind) => kind.value === value);
}

export function isEntityScopedSubject(subjectType: DocumentSubjectType): boolean {
  const entry: object = DOCUMENT_SUBJECTS[subjectType];
  return 'entityScoped' in entry && entry.entityScoped === true;
}

export function isDocumentSubjectType(value: unknown): value is DocumentSubjectType {
  return typeof value === 'string' && Object.hasOwn(DOCUMENT_SUBJECTS, value);
}

export function documentKindLabel(kind: string): string {
  return DOCUMENT_KINDS.find((entry) => entry.value === kind)?.label ?? 'Document';
}

/** "1.4 MB", "312 KB": sizes people can read. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
