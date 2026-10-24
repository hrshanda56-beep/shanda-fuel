import { describe, expect, it } from 'vitest';
import { AppError } from '../../platform/errors';
import { createPrivateObjectKey } from '../../platform/storage';
import {
  assertExpenseAttachmentAssociation,
  assertExpenseAttachmentPermission,
  createExpenseAttachmentObjectKey,
  MAX_EXPENSE_ATTACHMENT_BYTES,
  validateExpenseAttachmentFile,
} from './attachments';

const tenantId = '11111111-1111-4111-8111-111111111111';
const stationId = '22222222-2222-4222-8222-222222222222';
const otherStationId = '33333333-3333-4333-8333-333333333333';
const expenseId = '44444444-4444-4444-8444-444444444444';
const legalEntityId = '55555555-5555-4555-8555-555555555555';

const stationScope = {
  tenantId,
  scopeType: 'STATION' as const,
  legalEntityId,
  stationId,
};

describe('expense attachments', () => {
  it('accepts supported file types and records exact byte metadata', () => {
    const body = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const result = validateExpenseAttachmentFile({
      name: 'receipt.pdf',
      type: 'application/pdf',
      body,
    });

    expect(result).toMatchObject({
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
      byteSize: 5,
      sha256: '38523c087796e5d5dd1cf9bad1fb026781a838dd9dd2cf8af58b9f6502a46778',
    });
    expect(result.body).toBe(body);
  });

  it.each([
    ['receipt.exe', 'application/pdf'],
    ['receipt.pdf', 'image/png'],
    ['receipt.txt', 'text/plain'],
  ])('rejects unsafe filename/content-type combinations', (name, type) => {
    expect(() =>
      validateExpenseAttachmentFile({ name, type, body: new Uint8Array([1]) }),
    ).toThrowError(AppError);
  });

  it('rejects empty and over-limit files before storage', () => {
    expect(() =>
      validateExpenseAttachmentFile({
        name: 'empty.pdf',
        type: 'application/pdf',
        body: new Uint8Array(),
      }),
    ).toThrow('between 1 byte and 10 MB');
    expect(() =>
      validateExpenseAttachmentFile({
        name: 'large.pdf',
        type: 'application/pdf',
        body: new Uint8Array(MAX_EXPENSE_ATTACHMENT_BYTES + 1),
      }),
    ).toThrow('between 1 byte and 10 MB');
  });

  it('rejects content that does not match the declared evidence type', () => {
    expect(() =>
      validateExpenseAttachmentFile({
        name: 'receipt.pdf',
        type: 'application/pdf',
        body: new Uint8Array([1, 2, 3]),
      }),
    ).toThrow('does not match');
  });

  it('uses an opaque private key that cannot contain the client filename', () => {
    const key = createExpenseAttachmentObjectKey(expenseId);
    expect(key).toBe(createPrivateObjectKey('expense-attachments', expenseId));
    expect(key).not.toContain('.pdf');
    expect(key).not.toContain('..');
  });

  it('requires the requested station and tenant to match the exact expense association', () => {
    expect(
      assertExpenseAttachmentAssociation({
        requestedTenantId: tenantId,
        requestedStationId: stationId,
        expense: { tenantId, stationId, legalEntityId },
      }),
    ).toEqual({ legalEntityId });

    expect(() =>
      assertExpenseAttachmentAssociation({
        requestedTenantId: tenantId,
        requestedStationId: otherStationId,
        expense: { tenantId, stationId, legalEntityId },
      }),
    ).toThrow('not found at this station');
  });

  it('enforces the existing document permission at the exact station scope', () => {
    const financeActor = {
      userId: '66666666-6666-4666-8666-666666666666',
      membershipId: '77777777-7777-4777-8777-777777777777',
      tenantId,
      membershipActive: true,
      roleAssignments: [{ ...stationScope, roleCode: 'FINANCE' as const }],
    };
    expect(() =>
      assertExpenseAttachmentPermission({
        actor: financeActor,
        scope: stationScope,
        permissionCode: 'document.upload',
      }),
    ).not.toThrow();
    expect(() =>
      assertExpenseAttachmentPermission({
        actor: {
          ...financeActor,
          roleAssignments: [{ ...stationScope, roleCode: 'ATTENDANT' as const }],
        },
        scope: stationScope,
        permissionCode: 'document.view',
      }),
    ).toThrow('not authorized');
  });
});
