import { AppError } from '../../platform/errors';
import {
  ExactDecimal,
  money,
  type CurrencyCode,
  type Money,
} from '../../platform/domain/primitives';

export const SUPPLIER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export const SUPPLIER_DOCUMENT_TYPES = ['INVOICE', 'CREDIT_NOTE'] as const;
export type SupplierDocumentType = (typeof SUPPLIER_DOCUMENT_TYPES)[number];

export const SUPPLIER_DOCUMENT_STATES = [
  'DRAFT',
  'SUBMITTED',
  'POSTED',
  'PARTIALLY_PAID',
  'PAID',
  'REVERSED',
] as const;
export type SupplierDocumentState = (typeof SUPPLIER_DOCUMENT_STATES)[number];

export const SUPPLIER_PAYMENT_STATES = ['DRAFT', 'SUBMITTED', 'POSTED', 'REVERSED'] as const;
export type SupplierPaymentState = (typeof SUPPLIER_PAYMENT_STATES)[number];

export const SUPPLIER_LEDGER_MOVEMENT_TYPES = [
  'INVOICE',
  'CREDIT_NOTE',
  'PAYMENT',
  'PAYMENT_REVERSAL',
  'ADJUSTMENT',
] as const;
export type SupplierLedgerMovementType = (typeof SUPPLIER_LEDGER_MOVEMENT_TYPES)[number];

export type Supplier = Readonly<{
  id: string;
  tenantId: string;
  code: string;
  legalName: string;
  status: SupplierStatus;
}>;

export type SupplierDeliveryReference = Readonly<{
  tenantId: string;
  stationId: string;
  deliveryId: string;
  allocationId?: string;
}>;

export type SupplierDocument = Readonly<{
  id: string;
  tenantId: string;
  legalEntityId: string;
  supplierId: string;
  documentType: SupplierDocumentType;
  referenceNumber: string;
  documentDate: string;
  dueDate?: string;
  currency: CurrencyCode;
  amount: Money;
  state: SupplierDocumentState;
  deliveryReferences: readonly SupplierDeliveryReference[];
}>;

export type SupplierPayment = Readonly<{
  id: string;
  tenantId: string;
  legalEntityId: string;
  supplierId: string;
  paymentDate: string;
  amount: Money;
  reference: string;
  state: SupplierPaymentState;
}>;

export type PaymentAllocation = Readonly<{
  paymentId: string;
  documentId: string;
  tenantId: string;
  supplierId: string;
  amount: Money;
}>;

export type SupplierLedgerMovement = Readonly<{
  id: string;
  tenantId: string;
  supplierId: string;
  currency: CurrencyCode;
  movementType: SupplierLedgerMovementType;
  amount: Money;
  postedAt: string;
  sourceId: string;
  reversalOfMovementId?: string;
}>;

export type SupplierDocumentInput = Readonly<{
  tenantId: string;
  legalEntityId: string;
  supplierId: string;
  documentType: SupplierDocumentType;
  referenceNumber: string;
  documentDate: string;
  dueDate?: string;
  currency: CurrencyCode;
  amount: string;
  deliveryReferences?: readonly SupplierDeliveryReference[];
}>;

export type SupplierPaymentInput = Readonly<{
  tenantId: string;
  legalEntityId: string;
  supplierId: string;
  paymentDate: string;
  currency: CurrencyCode;
  amount: string;
  reference: string;
}>;

function requiredText(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION_FAILED', `${field} is required`);
  }
  return value.trim();
}

function isoDate(value: string, field: string): string {
  const normalized = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', `${field} must use YYYY-MM-DD`);
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new AppError('VALIDATION_FAILED', `${field} must be a valid calendar date`);
  }
  return normalized;
}

function positiveMoney(amount: string, currency: CurrencyCode, field: string): Money {
  let value: Money;
  try {
    value = money(amount, currency);
  } catch (error) {
    throw new AppError('VALIDATION_FAILED', `${field} must be a valid exact monetary amount`, {
      cause: error instanceof Error ? error.message : 'invalid amount',
    });
  }
  if (!value.amount.value.isPositive()) {
    throw new AppError('VALIDATION_FAILED', `${field} must be greater than zero`);
  }
  return value;
}

function assertSameCurrency(left: Money, right: Money, message: string): void {
  if (left.currency !== right.currency) {
    throw new AppError('INVARIANT_VIOLATION', message, {
      leftCurrency: left.currency,
      rightCurrency: right.currency,
    });
  }
}

function assertSameTenant(left: string, right: string, message: string): void {
  if (left !== right) throw new AppError('FORBIDDEN', message);
}

function assertSameSupplier(left: string, right: string, message: string): void {
  if (left !== right) throw new AppError('INVARIANT_VIOLATION', message);
}

export function validateSupplier(
  input: Omit<Supplier, 'status'> & { status?: SupplierStatus },
): Supplier {
  const code = requiredText(input.code, 'Supplier code');
  const legalName = requiredText(input.legalName, 'Supplier legal name');
  const status = input.status ?? 'ACTIVE';
  if (!SUPPLIER_STATUSES.includes(status)) {
    throw new AppError('VALIDATION_FAILED', 'Supplier status is invalid');
  }
  return {
    id: requiredText(input.id, 'Supplier id'),
    tenantId: requiredText(input.tenantId, 'Tenant id'),
    code,
    legalName,
    status,
  };
}

export function validateSupplierDocument(input: SupplierDocumentInput): Omit<
  SupplierDocumentInput,
  'amount'
> & {
  amount: Money;
  documentDate: string;
  dueDate?: string;
  referenceNumber: string;
} {
  const documentDate = isoDate(input.documentDate, 'Document date');
  const dueDate = input.dueDate === undefined ? undefined : isoDate(input.dueDate, 'Due date');
  if (dueDate !== undefined && dueDate < documentDate) {
    throw new AppError('VALIDATION_FAILED', 'Due date cannot precede document date');
  }
  if (!SUPPLIER_DOCUMENT_TYPES.includes(input.documentType)) {
    throw new AppError('VALIDATION_FAILED', 'Supplier document type is invalid');
  }
  const deliveryReferences = [...(input.deliveryReferences ?? [])];
  const seen = new Set<string>();
  for (const reference of deliveryReferences) {
    requiredText(reference.tenantId, 'Delivery reference tenant id');
    requiredText(reference.stationId, 'Delivery reference station id');
    requiredText(reference.deliveryId, 'Delivery reference delivery id');
    if (reference.allocationId !== undefined)
      requiredText(reference.allocationId, 'Delivery reference allocation id');
    assertSameTenant(
      input.tenantId,
      reference.tenantId,
      'A delivery reference must belong to the document tenant',
    );
    const key = `${reference.deliveryId}:${reference.allocationId ?? ''}`;
    if (seen.has(key))
      throw new AppError('CONFLICT', 'A supplier document cannot repeat a delivery reference');
    seen.add(key);
  }
  return {
    ...input,
    referenceNumber: requiredText(input.referenceNumber, 'Supplier document reference number'),
    documentDate,
    dueDate,
    amount: positiveMoney(input.amount, input.currency, 'Supplier document amount'),
    deliveryReferences,
  };
}

export function validateSupplierPayment(input: SupplierPaymentInput): Omit<
  SupplierPaymentInput,
  'amount'
> & {
  amount: Money;
  paymentDate: string;
  reference: string;
} {
  return {
    ...input,
    paymentDate: isoDate(input.paymentDate, 'Payment date'),
    reference: requiredText(input.reference, 'Payment reference'),
    amount: positiveMoney(input.amount, input.currency, 'Supplier payment amount'),
  };
}

const documentTransitions: Readonly<
  Record<SupplierDocumentState, readonly SupplierDocumentState[]>
> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['DRAFT', 'POSTED'],
  POSTED: ['PARTIALLY_PAID', 'PAID', 'REVERSED'],
  PARTIALLY_PAID: ['PAID', 'REVERSED'],
  PAID: ['REVERSED'],
  REVERSED: [],
};

export function assertSupplierDocumentTransition(
  from: SupplierDocumentState,
  to: SupplierDocumentState,
): void {
  if (!documentTransitions[from].includes(to)) {
    throw new AppError('CONFLICT', `Supplier document cannot transition from ${from} to ${to}`);
  }
}

export function assertSupplierPaymentTransition(
  from: SupplierPaymentState,
  to: SupplierPaymentState,
): void {
  const allowed: Readonly<Record<SupplierPaymentState, readonly SupplierPaymentState[]>> = {
    DRAFT: ['SUBMITTED'],
    SUBMITTED: ['DRAFT', 'POSTED'],
    POSTED: ['REVERSED'],
    REVERSED: [],
  };
  if (!allowed[from].includes(to)) {
    throw new AppError('CONFLICT', `Supplier payment cannot transition from ${from} to ${to}`);
  }
}

export function assertSupplierReferenceIsUnique(
  referenceNumber: string,
  existingReferences: readonly string[],
): string {
  const normalized = requiredText(referenceNumber, 'Supplier document reference number');
  if (existingReferences.some((reference) => reference.trim() === normalized)) {
    throw new AppError(
      'CONFLICT',
      'The supplier document reference already exists for this supplier',
    );
  }
  return normalized;
}

export function outstandingPayable(
  document: Pick<SupplierDocument, 'amount' | 'state'>,
  allocatedAmount: Money,
): Money {
  if (document.state === 'REVERSED') return money('0', document.amount.currency);
  assertSameCurrency(
    document.amount,
    allocatedAmount,
    'Document and allocation currencies must match',
  );
  if (allocatedAmount.amount.value.isNegative())
    throw new AppError('INVARIANT_VIOLATION', 'Allocated amount cannot be negative');
  if (allocatedAmount.amount.value.gt(document.amount.amount.value)) {
    throw new AppError('INVARIANT_VIOLATION', 'Allocated amount cannot exceed document amount');
  }
  return money(
    document.amount.amount.subtract(allocatedAmount.amount).toString(),
    document.amount.currency,
  );
}

export function validatePaymentAllocations(input: {
  payment: Pick<SupplierPayment, 'id' | 'tenantId' | 'supplierId' | 'amount' | 'state'>;
  documents: readonly (Pick<
    SupplierDocument,
    'id' | 'tenantId' | 'supplierId' | 'amount' | 'state'
  > & {
    allocatedAmount: Money;
    requestedAmount: Money;
  })[];
}): readonly PaymentAllocation[] {
  if (input.payment.state !== 'POSTED')
    throw new AppError('CONFLICT', 'Only posted supplier payments can be allocated');
  let total = new ExactDecimal('0');
  const allocations: PaymentAllocation[] = [];
  const seen = new Set<string>();
  for (const item of input.documents) {
    if (seen.has(item.id))
      throw new AppError(
        'CONFLICT',
        'A payment cannot allocate a document more than once in one command',
      );
    seen.add(item.id);
    assertSameTenant(
      input.payment.tenantId,
      item.tenantId,
      'Payment and document must belong to the same tenant',
    );
    assertSameSupplier(
      input.payment.supplierId,
      item.supplierId,
      'Payment and document must belong to the same supplier',
    );
    if (item.state === 'REVERSED')
      throw new AppError('CONFLICT', 'A reversed supplier document cannot receive an allocation');
    const remaining = outstandingPayable(item, item.allocatedAmount);
    if (remaining.amount.value.isZero())
      throw new AppError(
        'CONFLICT',
        'A fully allocated document cannot receive another allocation',
      );
    assertSameCurrency(
      input.payment.amount,
      remaining,
      'Payment and document currencies must match',
    );
    assertSameCurrency(
      input.payment.amount,
      item.requestedAmount,
      'Payment and requested allocation currencies must match',
    );
    if (!item.requestedAmount.amount.value.isPositive()) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Requested allocation amount must be greater than zero',
      );
    }
    if (item.requestedAmount.amount.value.gt(remaining.amount.value)) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'Requested allocation cannot exceed document outstanding amount',
      );
    }
    total = total.add(item.requestedAmount.amount);
    allocations.push({
      paymentId: input.payment.id,
      documentId: item.id,
      tenantId: input.payment.tenantId,
      supplierId: input.payment.supplierId,
      amount: item.requestedAmount,
    });
  }
  if (total.value.gt(input.payment.amount.amount.value)) {
    throw new AppError('INVARIANT_VIOLATION', 'Payment allocations cannot exceed payment capacity');
  }
  return allocations;
}

export function assertAllocationWithinCapacity(
  paymentAmount: Money,
  alreadyAllocated: Money,
  requested: Money,
): void {
  assertSameCurrency(
    paymentAmount,
    alreadyAllocated,
    'Payment capacity and existing allocation currencies must match',
  );
  assertSameCurrency(
    paymentAmount,
    requested,
    'Payment capacity and requested allocation currencies must match',
  );
  if (alreadyAllocated.amount.value.isNegative() || requested.amount.value.isNegative()) {
    throw new AppError('INVARIANT_VIOLATION', 'Payment allocation amounts cannot be negative');
  }
  if (alreadyAllocated.amount.add(requested.amount).value.gt(paymentAmount.amount.value)) {
    throw new AppError('INVARIANT_VIOLATION', 'Payment allocations cannot exceed payment capacity');
  }
}

function ledgerSign(type: SupplierLedgerMovementType): 1 | -1 {
  return type === 'INVOICE' || type === 'PAYMENT_REVERSAL' ? 1 : -1;
}

export function calculateSupplierPayableBalance(
  entries: readonly SupplierLedgerMovement[],
  currency: CurrencyCode,
): Money {
  let balance = new ExactDecimal('0');
  const first = entries[0];
  for (const entry of entries) {
    if (entry.currency !== currency || entry.amount.currency !== currency) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'Supplier ledger entries must use one currency per balance',
      );
    }
    if (first && (entry.tenantId !== first.tenantId || entry.supplierId !== first.supplierId)) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'Supplier ledger balance cannot combine tenants or suppliers',
      );
    }
    if (!entry.amount.amount.value.isPositive())
      throw new AppError(
        'INVARIANT_VIOLATION',
        'Supplier ledger movement amounts must be positive',
      );
    balance = balance.add(
      entry.amount.amount.multiply(new ExactDecimal(String(ledgerSign(entry.movementType)))),
    );
  }
  return money(balance.toString(), currency);
}
