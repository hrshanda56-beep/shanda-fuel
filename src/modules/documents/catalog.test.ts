import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_SUBJECTS,
  documentKindLabel,
  formatFileSize,
  isDocumentKind,
  isDocumentSubjectType,
} from './catalog';

describe('document catalog', () => {
  it('only accepts known kinds and subjects', () => {
    expect(isDocumentKind('INVOICE')).toBe(true);
    expect(isDocumentKind('invoice')).toBe(false);
    expect(isDocumentKind(undefined)).toBe(false);
    expect(isDocumentSubjectType('FUEL_DELIVERY')).toBe(true);
    expect(isDocumentSubjectType('SUPPLIER_PAYMENT')).toBe(true);
    expect(isDocumentSubjectType('toString')).toBe(false);
    expect(isDocumentSubjectType('__proto__')).toBe(false);
  });

  it('names every subject’s table once, and only tables that exist in the app schema', () => {
    const tables = Object.values(DOCUMENT_SUBJECTS).map((subject) => subject.table);
    expect(new Set(tables).size).toBe(tables.length);
    for (const table of tables) expect(table).toMatch(/^[a-z_]+$/);
  });

  it('writes plain labels and sizes', () => {
    expect(documentKindLabel('DEPOSIT_SLIP')).toBe('Bank deposit slip');
    expect(documentKindLabel('PAYMENT_PROOF')).toBe('Proof of payment');
    expect(documentKindLabel('???')).toBe('Document');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(312 * 1024)).toBe('312 KB');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});
