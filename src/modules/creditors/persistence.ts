import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import { ExactDecimal, money } from '../../platform/domain/primitives';
import {
  assertSupplierDocumentTransition,
  assertSupplierPaymentTransition,
  validatePaymentAllocations,
  validateSupplierDocument,
  validateSupplierPayment,
  type SupplierDocumentType,
} from './domain';
import type { SupplierCommandContext, SupplierTransaction } from './application';

type DocumentRow = {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  supplier_id: string;
  document_type: SupplierDocumentType;
  reference_number: string;
  document_date: string;
  due_date: string | null;
  currency: string;
  amount: string;
  state: string;
  version: number | string;
};

type PaymentRow = {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  supplier_id: string;
  payment_date: string;
  payment_reference: string;
  currency: string;
  amount: string;
  state: string;
  version: number | string;
};

function decimal(value: string): ExactDecimal {
  return new ExactDecimal(value);
}

async function assertSupplierAndEntity(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  supplierId: string,
): Promise<void> {
  const rows = await transaction.execute<{ id: string }>(sql`
    select s.id
    from app.suppliers s
    where s.tenant_id = ${context.tenantId}
      and s.id = ${supplierId}
      and s.status = 'ACTIVE'
    limit 1
  `);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'The supplier was not found or is inactive');
}

export async function createSupplierInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: { code: string; legalName: string; registrationReference?: string },
) {
  if (!input.code.trim() || !input.legalName.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Supplier code and legal name are required');
  }
  const id = randomUUID();
  await transaction.execute(sql`
    insert into app.suppliers (
      id, tenant_id, code, legal_name, registration_reference, status,
      created_by, updated_by
    ) values (
      ${id}, ${context.tenantId}, ${input.code.trim()}, ${input.legalName.trim()},
      ${input.registrationReference?.trim() || null}, 'ACTIVE',
      ${context.authority.membership.membershipId}, ${context.authority.membership.membershipId}
    )
  `);
  return { supplierId: id, code: input.code.trim(), legalName: input.legalName.trim() };
}

export async function submitSupplierDocumentInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: {
    supplierId: string;
    documentType: SupplierDocumentType;
    referenceNumber: string;
    documentDate: string;
    dueDate?: string;
    amount: string;
    deliveryReferences?: readonly {
      stationId: string;
      deliveryId: string;
      allocationId?: string;
    }[];
  },
) {
  await assertSupplierAndEntity(transaction, context, input.supplierId);
  const validated = validateSupplierDocument({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    supplierId: input.supplierId,
    documentType: input.documentType,
    referenceNumber: input.referenceNumber,
    documentDate: input.documentDate,
    dueDate: input.dueDate,
    currency: 'USD',
    amount: input.amount,
    deliveryReferences: (input.deliveryReferences ?? []).map((reference) => ({
      tenantId: context.tenantId,
      ...reference,
    })),
  });
  const id = randomUUID();
  const deliveryReferences = validated.deliveryReferences ?? [];
  await transaction.execute(sql`
    insert into app.supplier_documents (
      id, tenant_id, legal_entity_id, supplier_id, document_type,
      reference_number, document_date, due_date, currency, amount,
      state, version, created_by, submitted_by, submitted_at
    ) values (
      ${id}, ${context.tenantId}, ${context.legalEntityId}, ${input.supplierId},
      ${validated.documentType}, ${validated.referenceNumber}, ${validated.documentDate},
      ${validated.dueDate ?? null}, 'USD', ${validated.amount.amount.toString()},
      'SUBMITTED', 0, ${context.authority.membership.membershipId},
      ${context.authority.membership.membershipId}, now()
    )
  `);
  for (const reference of deliveryReferences) {
    await transaction.execute(sql`
      insert into app.supplier_document_delivery_refs (
        id, tenant_id, legal_entity_id, station_id, supplier_document_id,
        delivery_id, allocation_id, linked_by
      ) values (
        ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${reference.stationId},
        ${id}, ${reference.deliveryId}, ${reference.allocationId ?? null},
        ${context.authority.membership.membershipId}
      )
    `);
  }
  return {
    documentId: id,
    state: 'SUBMITTED' as const,
    amount: validated.amount.amount.toString(),
  };
}

export async function postSupplierDocumentInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: { documentId: string; expectedVersion: number },
) {
  const rows = await transaction.execute<DocumentRow>(sql`
    select id, tenant_id, legal_entity_id, supplier_id, document_type, reference_number,
           document_date, due_date, currency, amount, state, version
    from app.supplier_documents
    where tenant_id = ${context.tenantId}
      and legal_entity_id = ${context.legalEntityId}
      and id = ${input.documentId}
    for update
  `);
  const document = rows[0];
  if (!document) throw new AppError('NOT_FOUND', 'The supplier document was not found');
  if (Number(document.version) !== input.expectedVersion) {
    throw new AppError('CONFLICT', 'The supplier document is stale', {
      expectedVersion: input.expectedVersion,
      actualVersion: Number(document.version),
    });
  }
  assertSupplierDocumentTransition(document.state as never, 'POSTED');
  await transaction.execute(sql`
    update app.supplier_documents
    set state = 'POSTED', posted_by = ${context.authority.membership.membershipId},
        posted_at = now(), version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${document.id}
      and version = ${input.expectedVersion}
  `);
  await transaction.execute(sql`
    insert into app.supplier_account_movements (
      id, tenant_id, legal_entity_id, supplier_id, movement_type, amount, currency,
      source_type, source_id, effective_date, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${document.supplier_id},
      ${document.document_type}, ${document.amount}, 'USD', 'SUPPLIER_DOCUMENT', ${document.id},
      ${document.document_date}, ${context.authority.membership.membershipId}
    )
  `);
  return { documentId: document.id, state: 'POSTED' as const, version: input.expectedVersion + 1 };
}

export async function reverseSupplierDocumentInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: { documentId: string; expectedVersion: number; reason: string },
) {
  if (!input.reason.trim())
    throw new AppError('VALIDATION_FAILED', 'A reversal reason is required');
  const rows = await transaction.execute<DocumentRow>(sql`
    select id, tenant_id, legal_entity_id, supplier_id, document_type, reference_number,
           document_date, due_date, currency, amount, state, version
    from app.supplier_documents
    where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
      and id = ${input.documentId}
    for update
  `);
  const document = rows[0];
  if (!document) throw new AppError('NOT_FOUND', 'The supplier document was not found');
  if (Number(document.version) !== input.expectedVersion)
    throw new AppError('CONFLICT', 'The supplier document is stale');
  if (document.document_type !== 'INVOICE') {
    throw new AppError(
      'CONFLICT',
      'Credit-note reversal requires an approved accounting adjustment policy',
    );
  }
  assertSupplierDocumentTransition(document.state as never, 'REVERSED');
  const original = await transaction.execute<{ id: string }>(sql`
    select id from app.supplier_account_movements
    where tenant_id = ${context.tenantId} and source_type = 'SUPPLIER_DOCUMENT'
      and source_id = ${document.id} and movement_type = 'INVOICE'
    limit 1
  `);
  await transaction.execute(sql`
    update app.supplier_documents
    set state = 'REVERSED', reversed_by = ${context.authority.membership.membershipId},
        reversed_at = now(), reversal_reason = ${input.reason.trim()},
        version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${document.id}
      and version = ${input.expectedVersion}
  `);
  await transaction.execute(sql`
    insert into app.supplier_account_movements (
      id, tenant_id, legal_entity_id, supplier_id, movement_type, amount, currency,
      source_type, source_id, effective_date, reversal_of_id, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${document.supplier_id},
      'ADJUSTMENT', ${document.amount}, 'USD', 'SUPPLIER_DOCUMENT_REVERSAL', ${document.id},
      ${document.document_date}, ${original[0]?.id ?? null}, ${context.authority.membership.membershipId}
    )
  `);
  const allocations = await transaction.execute<{
    id: string;
    payment_id: string;
    amount: string;
  }>(sql`
    select a.id, a.payment_id, a.amount::text
    from app.supplier_payment_allocations a
    where a.tenant_id = ${context.tenantId} and a.document_id = ${document.id}
      and a.state = 'POSTED'
      and not exists (select 1 from app.supplier_payment_allocations r
        where r.tenant_id = a.tenant_id and r.reversal_of_id = a.id and r.state = 'REVERSED')
    order by a.id
    for update
  `);
  const affectedPayments = new Set<string>();
  for (const allocation of allocations) {
    affectedPayments.add(allocation.payment_id);
    await transaction.execute(sql`
      insert into app.supplier_payment_allocations (
        id, tenant_id, legal_entity_id, supplier_id, payment_id, document_id,
        amount, currency, state, reversal_of_id, allocated_by
      ) values (
        ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${document.supplier_id},
        ${allocation.payment_id}, ${document.id}, ${allocation.amount}, 'USD', 'REVERSED',
        ${allocation.id}, ${context.authority.membership.membershipId}
      )
    `);
  }
  for (const paymentId of affectedPayments) {
    await transaction.execute(sql`
      update app.supplier_payments set version = version + 1, updated_at = now()
      where tenant_id = ${context.tenantId} and id = ${paymentId}
    `);
  }
  return {
    documentId: document.id,
    state: 'REVERSED' as const,
    reversedAllocationCount: allocations.length,
  };
}

export async function submitSupplierPaymentInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: { supplierId: string; paymentDate: string; amount: string; reference: string },
) {
  await assertSupplierAndEntity(transaction, context, input.supplierId);
  const validated = validateSupplierPayment({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    supplierId: input.supplierId,
    paymentDate: input.paymentDate,
    currency: 'USD',
    amount: input.amount,
    reference: input.reference,
  });
  const id = randomUUID();
  await transaction.execute(sql`
    insert into app.supplier_payments (
      id, tenant_id, legal_entity_id, supplier_id, payment_date,
      payment_reference, currency, amount, state, version, created_by,
      submitted_by, submitted_at
    ) values (
      ${id}, ${context.tenantId}, ${context.legalEntityId}, ${input.supplierId},
      ${validated.paymentDate}, ${validated.reference}, 'USD', ${validated.amount.amount.toString()},
      'SUBMITTED', 0, ${context.authority.membership.membershipId},
      ${context.authority.membership.membershipId}, now()
    )
  `);
  return { paymentId: id, state: 'SUBMITTED' as const, amount: validated.amount.amount.toString() };
}

export async function postSupplierPaymentInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: { paymentId: string; expectedVersion: number },
) {
  const rows = await transaction.execute<PaymentRow>(sql`
    select id, tenant_id, legal_entity_id, supplier_id, payment_date, payment_reference,
           currency, amount, state, version
    from app.supplier_payments
    where tenant_id = ${context.tenantId}
      and legal_entity_id = ${context.legalEntityId}
      and id = ${input.paymentId}
    for update
  `);
  const payment = rows[0];
  if (!payment) throw new AppError('NOT_FOUND', 'The supplier payment was not found');
  if (Number(payment.version) !== input.expectedVersion) {
    throw new AppError('CONFLICT', 'The supplier payment is stale');
  }
  assertSupplierPaymentTransition(payment.state as never, 'POSTED');
  await transaction.execute(sql`
    update app.supplier_payments
    set state = 'POSTED', posted_by = ${context.authority.membership.membershipId},
        posted_at = now(), version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${payment.id}
      and version = ${input.expectedVersion}
  `);
  await transaction.execute(sql`
    insert into app.supplier_account_movements (
      id, tenant_id, legal_entity_id, supplier_id, movement_type, amount, currency,
      source_type, source_id, effective_date, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${payment.supplier_id},
      'PAYMENT', ${payment.amount}, 'USD', 'SUPPLIER_PAYMENT', ${payment.id},
      ${payment.payment_date}, ${context.authority.membership.membershipId}
    )
  `);
  return { paymentId: payment.id, state: 'POSTED' as const, version: input.expectedVersion + 1 };
}

export async function allocateSupplierPaymentInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: {
    paymentId: string;
    expectedVersion: number;
    allocations: readonly { documentId: string; amount: string }[];
  },
) {
  const paymentRows = await transaction.execute<PaymentRow>(sql`
    select id, tenant_id, legal_entity_id, supplier_id, payment_date, payment_reference,
           currency, amount, state, version
    from app.supplier_payments
    where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
      and id = ${input.paymentId}
    for update
  `);
  const payment = paymentRows[0];
  if (!payment) throw new AppError('NOT_FOUND', 'The supplier payment was not found');
  if (Number(payment.version) !== input.expectedVersion)
    throw new AppError('CONFLICT', 'The supplier payment is stale');
  const ids = [...new Set(input.allocations.map((item) => item.documentId))].sort();
  if (ids.length !== input.allocations.length)
    throw new AppError('CONFLICT', 'Each document may appear once per allocation command');
  const documents: (DocumentRow & { allocatedAmount: string })[] = [];
  for (const documentId of ids) {
    const rows = await transaction.execute<DocumentRow & { allocated_amount: string }>(sql`
      select d.id, d.tenant_id, d.legal_entity_id, d.supplier_id, d.document_type,
             d.reference_number, d.document_date, d.due_date, d.currency, d.amount,
             d.state, d.version,
             coalesce((select sum(a.amount) from app.supplier_payment_allocations a
               where a.tenant_id = d.tenant_id and a.document_id = d.id and a.state = 'POSTED'
                 and not exists (select 1 from app.supplier_payment_allocations r
                   where r.tenant_id = a.tenant_id and r.reversal_of_id = a.id and r.state = 'REVERSED')), 0)::text as allocated_amount
      from app.supplier_documents d
      where d.tenant_id = ${context.tenantId} and d.legal_entity_id = ${context.legalEntityId}
        and d.id = ${documentId}
      for update
    `);
    if (!rows[0]) throw new AppError('NOT_FOUND', 'A supplier document was not found');
    documents.push({ ...rows[0], allocatedAmount: rows[0].allocated_amount });
  }
  const allocations = validatePaymentAllocations({
    payment: {
      id: payment.id,
      tenantId: payment.tenant_id,
      supplierId: payment.supplier_id,
      amount: money(payment.amount, 'USD'),
      state: payment.state as never,
    },
    documents: documents.map((document) => ({
      id: document.id,
      tenantId: document.tenant_id,
      supplierId: document.supplier_id,
      amount: money(document.amount, 'USD'),
      state: document.state as never,
      allocatedAmount: money(document.allocatedAmount, 'USD'),
      requestedAmount: money(
        input.allocations.find((item) => item.documentId === document.id)!.amount,
        'USD',
      ),
    })),
  });
  for (const allocation of allocations) {
    await transaction.execute(sql`
      insert into app.supplier_payment_allocations (
        id, tenant_id, legal_entity_id, supplier_id, payment_id, document_id,
        amount, currency, state, allocated_by
      ) values (
        ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${allocation.supplierId},
        ${allocation.paymentId}, ${allocation.documentId}, ${allocation.amount.amount.toString()},
        'USD', 'POSTED', ${context.authority.membership.membershipId}
      )
    `);
  }
  for (const document of documents) {
    const current = decimal(document.allocatedAmount);
    const added = decimal(
      input.allocations.find((item) => item.documentId === document.id)!.amount,
    );
    const total = current.add(added);
    const state = total.equals(decimal(document.amount)) ? 'PAID' : 'PARTIALLY_PAID';
    await transaction.execute(sql`
      update app.supplier_documents
      set state = ${state}, version = version + 1, updated_at = now()
      where tenant_id = ${context.tenantId} and id = ${document.id}
    `);
  }
  await transaction.execute(sql`
    update app.supplier_payments
    set version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${payment.id}
      and version = ${input.expectedVersion}
  `);
  return {
    paymentId: payment.id,
    allocationCount: allocations.length,
    version: input.expectedVersion + 1,
  };
}

export async function reverseSupplierPaymentInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: { paymentId: string; expectedVersion: number; reason: string },
) {
  if (!input.reason.trim())
    throw new AppError('VALIDATION_FAILED', 'A reversal reason is required');
  const rows = await transaction.execute<PaymentRow>(sql`
    select id, tenant_id, legal_entity_id, supplier_id, payment_date, payment_reference,
           currency, amount, state, version
    from app.supplier_payments
    where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
      and id = ${input.paymentId}
    for update
  `);
  const payment = rows[0];
  if (!payment) throw new AppError('NOT_FOUND', 'The supplier payment was not found');
  if (Number(payment.version) !== input.expectedVersion)
    throw new AppError('CONFLICT', 'The supplier payment is stale');
  assertSupplierPaymentTransition(payment.state as never, 'REVERSED');
  const original = await transaction.execute<{ id: string }>(sql`
    select id from app.supplier_account_movements
    where tenant_id = ${context.tenantId} and source_type = 'SUPPLIER_PAYMENT'
      and source_id = ${payment.id} and movement_type = 'PAYMENT'
    limit 1
  `);
  await transaction.execute(sql`
    update app.supplier_payments
    set state = 'REVERSED', reversed_by = ${context.authority.membership.membershipId},
        reversed_at = now(), reversal_reason = ${input.reason.trim()},
        version = version + 1, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${payment.id}
      and version = ${input.expectedVersion}
  `);
  await transaction.execute(sql`
    insert into app.supplier_account_movements (
      id, tenant_id, legal_entity_id, supplier_id, movement_type, amount, currency,
      source_type, source_id, effective_date, reversal_of_id, actor_membership_id
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${payment.supplier_id},
      'PAYMENT_REVERSAL', ${payment.amount}, 'USD', 'SUPPLIER_PAYMENT_REVERSAL', ${payment.id},
      ${payment.payment_date}, ${original[0]?.id ?? null}, ${context.authority.membership.membershipId}
    )
  `);
  const allocations = await transaction.execute<{
    id: string;
    document_id: string;
    amount: string;
  }>(sql`
    select a.id, a.document_id, a.amount::text
    from app.supplier_payment_allocations a
    where a.tenant_id = ${context.tenantId} and a.payment_id = ${payment.id}
      and a.state = 'POSTED'
      and not exists (select 1 from app.supplier_payment_allocations r
        where r.tenant_id = a.tenant_id and r.reversal_of_id = a.id and r.state = 'REVERSED')
    order by a.id
    for update
  `);
  for (const allocation of allocations) {
    await transaction.execute(sql`
      insert into app.supplier_payment_allocations (
        id, tenant_id, legal_entity_id, supplier_id, payment_id, document_id,
        amount, currency, state, reversal_of_id, allocated_by
      ) values (
        ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${payment.supplier_id},
        ${payment.id}, ${allocation.document_id}, ${allocation.amount}, 'USD', 'REVERSED',
        ${allocation.id}, ${context.authority.membership.membershipId}
      )
    `);
    await transaction.execute(sql`
      update app.supplier_documents d
      set state = case when exists (
        select 1 from app.supplier_payment_allocations a
        where a.tenant_id = d.tenant_id and a.document_id = d.id and a.state = 'POSTED'
          and not exists (select 1 from app.supplier_payment_allocations r
            where r.tenant_id = a.tenant_id and r.reversal_of_id = a.id and r.state = 'REVERSED')
      ) then 'PARTIALLY_PAID' else 'POSTED' end,
      version = version + 1, updated_at = now()
      where d.tenant_id = ${context.tenantId} and d.id = ${allocation.document_id}
    `);
  }
  return {
    paymentId: payment.id,
    state: 'REVERSED' as const,
    reversedAllocationCount: allocations.length,
  };
}
