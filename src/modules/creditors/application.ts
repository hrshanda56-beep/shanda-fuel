import { createHash } from 'node:crypto';
import { AppError } from '../../platform/errors';
import type {
  SupplierCommandEnvelope,
  SupplierCommandType,
  SupplierSourceReference,
} from './contracts';
import { SUPPLIER_COMMAND_POLICY } from './contracts';

export function supplierRequestHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function validateSupplierCommandEnvelope(
  input: SupplierCommandEnvelope,
): SupplierCommandEnvelope {
  const policy = SUPPLIER_COMMAND_POLICY[input.commandType];
  if (!policy) throw new AppError('VALIDATION_FAILED', 'Unsupported supplier command');
  for (const [field, value] of Object.entries(input)) {
    if (field === 'expectedVersion') continue;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new AppError('VALIDATION_FAILED', `${field} is required`);
    }
  }
  if (policy.requiresExpectedVersion && input.expectedVersion === undefined) {
    throw new AppError('VALIDATION_FAILED', `${input.commandType} requires an expected version`);
  }
  if (
    input.expectedVersion !== undefined &&
    (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)
  ) {
    throw new AppError('VALIDATION_FAILED', 'Expected version must be a non-negative integer');
  }
  return input;
}

export function validateSupplierSourceReference(
  reference: SupplierSourceReference,
): SupplierSourceReference {
  if (!reference.tenantId.trim() || !reference.sourceId.trim()) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Supplier source references require tenant and source identifiers',
    );
  }
  if (reference.sourceType === 'A4_DELIVERY' && !reference.stationId?.trim()) {
    throw new AppError('VALIDATION_FAILED', 'A4 delivery references require station scope');
  }
  return reference;
}

export function assertSupplierSourceReferencesSameTenant(
  tenantId: string,
  references: readonly SupplierSourceReference[],
): void {
  for (const reference of references) {
    validateSupplierSourceReference(reference);
    if (reference.tenantId !== tenantId) {
      throw new AppError(
        'FORBIDDEN',
        'Supplier source references must belong to the command tenant',
      );
    }
  }
}

export function requiredSupplierCommandPermission(commandType: SupplierCommandType): string {
  return SUPPLIER_COMMAND_POLICY[commandType].permissionCode;
}
