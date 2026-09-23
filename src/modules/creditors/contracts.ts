import type { CurrencyCode, Money } from '../../platform/domain/primitives';
import type {
  SupplierDocumentState,
  SupplierDocumentType,
  SupplierLedgerMovementType,
  SupplierPaymentState,
} from './domain';

/** Proposed permission codes; central registration is deferred to productionization. */
export const SUPPLIER_PERMISSION_CODES = [
  'supplier.view',
  'supplier.manage',
  'supplier.document.create',
  'supplier.document.post',
  'supplier.payment.create',
  'supplier.payment.post',
  'supplier.payment.allocate',
  'supplier.payment.reverse',
  'supplier.creditor.review',
] as const;
export type SupplierPermissionCode = (typeof SUPPLIER_PERMISSION_CODES)[number];

export type SupplierSourceReference = Readonly<{
  sourceType: 'A4_DELIVERY' | 'SUPPLIER_DOCUMENT' | 'SUPPLIER_PAYMENT';
  sourceId: string;
  tenantId: string;
  stationId?: string;
  allocationId?: string;
}>;

export type SupplierCommandType =
  | 'SubmitSupplierDocument'
  | 'PostSupplierDocument'
  | 'SubmitSupplierPayment'
  | 'PostSupplierPayment'
  | 'AllocateSupplierPayment'
  | 'ReverseSupplierPayment';

export type SupplierCommandEnvelope = Readonly<{
  commandType: SupplierCommandType;
  tenantId: string;
  legalEntityId: string;
  actorId: string;
  membershipId: string;
  requestId: string;
  idempotencyKey: string;
  requestHash: string;
  expectedVersion?: number;
}>;

export type SupplierCommandPolicy = Readonly<{
  permissionCode: SupplierPermissionCode;
  requiresApproval: boolean;
  requiresExpectedVersion: boolean;
}>;

export const SUPPLIER_COMMAND_POLICY: Readonly<Record<SupplierCommandType, SupplierCommandPolicy>> =
  {
    SubmitSupplierDocument: {
      permissionCode: 'supplier.document.create',
      requiresApproval: false,
      requiresExpectedVersion: true,
    },
    PostSupplierDocument: {
      permissionCode: 'supplier.document.post',
      requiresApproval: true,
      requiresExpectedVersion: true,
    },
    SubmitSupplierPayment: {
      permissionCode: 'supplier.payment.create',
      requiresApproval: false,
      requiresExpectedVersion: true,
    },
    PostSupplierPayment: {
      permissionCode: 'supplier.payment.post',
      requiresApproval: true,
      requiresExpectedVersion: true,
    },
    AllocateSupplierPayment: {
      permissionCode: 'supplier.payment.allocate',
      requiresApproval: false,
      requiresExpectedVersion: true,
    },
    ReverseSupplierPayment: {
      permissionCode: 'supplier.payment.reverse',
      requiresApproval: true,
      requiresExpectedVersion: true,
    },
  };

export type SupplierDocumentPostedEvent = Readonly<{
  eventType: 'supplier.document_posted.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  supplierId: string;
  documentId: string;
  documentType: SupplierDocumentType;
  referenceNumber: string;
  amount: Money;
  state: SupplierDocumentState;
  sourceReferences: readonly SupplierSourceReference[];
  occurredAt: string;
}>;

export type SupplierPaymentPostedEvent = Readonly<{
  eventType: 'supplier.payment_posted.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  supplierId: string;
  paymentId: string;
  amount: Money;
  state: SupplierPaymentState;
  occurredAt: string;
}>;

export type SupplierPaymentAllocatedEvent = Readonly<{
  eventType: 'supplier.payment_allocated.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  supplierId: string;
  paymentId: string;
  documentId: string;
  allocatedAmount: Money;
  occurredAt: string;
}>;

export type SupplierLedgerMovementSnapshot = Readonly<{
  tenantId: string;
  supplierId: string;
  movementType: SupplierLedgerMovementType;
  amount: Money;
  sourceId: string;
  postedAt: string;
}>;

export type SupplierReadModelQuery = Readonly<{
  tenantId: string;
  legalEntityId?: string;
  supplierId?: string;
  currency?: CurrencyCode;
  asOf?: string;
}>;

export type SupplierAgingRow = Readonly<{
  supplierId: string;
  currency: CurrencyCode;
  current: Money;
  overdue: Money;
  total: Money;
}>;

export type SupplierStatementRow = Readonly<{
  sourceId: string;
  movementType: SupplierLedgerMovementType;
  effectiveDate: string;
  postedAt: string;
  amount: Money;
  runningBalance: Money;
}>;

export interface SupplierReadModelPort {
  getAging(query: SupplierReadModelQuery): Promise<readonly SupplierAgingRow[]>;
  getStatement(query: SupplierReadModelQuery): Promise<readonly SupplierStatementRow[]>;
}
