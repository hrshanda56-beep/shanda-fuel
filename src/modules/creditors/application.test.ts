import { describe, expect, it } from 'vitest';
import {
  assertSupplierSourceReferencesSameTenant,
  requiredSupplierCommandPermission,
  supplierRequestHash,
  validateSupplierCommandEnvelope,
  validateSupplierSourceReference,
} from './application';

describe('supplier creditor application contracts', () => {
  it('requires idempotency, request identity, and expected versions', () => {
    const envelope = {
      commandType: 'PostSupplierDocument' as const,
      tenantId: 'tenant-1',
      legalEntityId: 'legal-1',
      actorId: 'actor-1',
      membershipId: 'membership-1',
      requestId: 'request-1',
      idempotencyKey: 'supplier-document-post-1',
      requestHash: supplierRequestHash({ documentId: 'document-1' }),
      expectedVersion: 0,
    };
    expect(validateSupplierCommandEnvelope(envelope)).toEqual(envelope);
    expect(requiredSupplierCommandPermission('PostSupplierDocument')).toBe(
      'supplier.document.post',
    );
    expect(() =>
      validateSupplierCommandEnvelope({ ...envelope, idempotencyKey: '', expectedVersion: 1 }),
    ).toThrow('idempotencyKey');
    expect(() =>
      validateSupplierCommandEnvelope({ ...envelope, expectedVersion: undefined }),
    ).toThrow('expected version');
  });

  it('keeps source references tenant-safe and station-scoped for A4 deliveries', () => {
    const reference = {
      sourceType: 'A4_DELIVERY' as const,
      sourceId: 'delivery-1',
      tenantId: 'tenant-1',
      stationId: 'station-1',
    };
    expect(validateSupplierSourceReference(reference)).toEqual(reference);
    expect(() => assertSupplierSourceReferencesSameTenant('tenant-2', [reference])).toThrow(
      'command tenant',
    );
    expect(() => validateSupplierSourceReference({ ...reference, stationId: undefined })).toThrow(
      'station scope',
    );
  });
});
