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
import { resolveCreditTerms } from './credit-terms';
import { assertHeaderMatchesLines, type InvoiceLineInput } from './purchasing-policy';
import {
  assertDeliveryUsable,
  evaluateDocumentVariance,
  findCoverageConflict,
  loadPurchasingPolicy,
  lockDeliveries,
  prepareSubmission,
  uniqueViolationOf,
  type DeliveryLinkInput,
  type PostedRef,
} from './purchasing-persistence';

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
  submitted_by: string | null;
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
  if (!rows[0]) throw new AppError('NOT_FOUND', 'That supplier is no longer available');
}

export async function createSupplierInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: {
    code: string;
    legalName: string;
    registrationReference?: string | undefined;
    contactName?: string | null | undefined;
    contactPhone?: string | null | undefined;
    contactEmail?: string | null | undefined;
    defaultCreditDays?: number | null | undefined;
    creditLimit?: string | null | undefined;
  },
) {
  if (!input.code.trim() || !input.legalName.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Supplier code and legal name are required');
  }
  const id = randomUUID();
  await transaction.execute(sql`
    insert into app.suppliers (
      id, tenant_id, code, legal_name, registration_reference, status,
      contact_name, contact_phone, contact_email, default_credit_days, credit_limit,
      created_by, updated_by
    ) values (
      ${id}, ${context.tenantId}, ${input.code.trim()}, ${input.legalName.trim()},
      ${input.registrationReference?.trim() || null}, 'ACTIVE',
      ${input.contactName?.trim() || null}, ${input.contactPhone?.trim() || null},
      ${input.contactEmail?.trim() || null}, ${input.defaultCreditDays ?? null},
      ${input.creditLimit ?? null},
      ${context.authority.membership.membershipId}, ${context.authority.membership.membershipId}
    )
  `);
  return { supplierId: id, code: input.code.trim(), legalName: input.legalName.trim() };
}

/** Changes who to contact and the usual credit period. A field left out stays as it was; null clears it. */
export async function updateSupplierDetailsInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: {
    supplierId: string;
    expectedVersion: number;
    contactName?: string | null | undefined;
    contactPhone?: string | null | undefined;
    contactEmail?: string | null | undefined;
    defaultCreditDays?: number | null | undefined;
  },
) {
  const pick = <T>(value: T | undefined, column: ReturnType<typeof sql.raw>) =>
    value === undefined ? sql`${column}` : sql`${value}`;
  const text = (value: string | null | undefined) =>
    value === undefined ? undefined : value?.trim() || null;
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.suppliers
    set contact_name = ${pick(text(input.contactName), sql.raw('contact_name'))},
        contact_phone = ${pick(text(input.contactPhone), sql.raw('contact_phone'))},
        contact_email = ${pick(text(input.contactEmail), sql.raw('contact_email'))},
        default_credit_days = ${pick(input.defaultCreditDays, sql.raw('default_credit_days'))},
        version = version + 1,
        updated_by = ${context.authority.membership.membershipId},
        updated_at = now()
    where tenant_id = ${context.tenantId}
      and id = ${input.supplierId}
      and version = ${input.expectedVersion}
    returning version
  `);
  if (!updated[0]) {
    const exists = await transaction.execute<{ id: string }>(sql`
      select id from app.suppliers where tenant_id = ${context.tenantId} and id = ${input.supplierId}
    `);
    if (!exists[0]) throw new AppError('NOT_FOUND', 'That supplier was not found');
    throw new AppError('CONFLICT', 'Someone else changed this supplier. Refresh and try again.');
  }
  return { supplierId: input.supplierId, version: Number(updated[0].version) };
}

/** Sets or clears the most this business wants to owe one supplier. It never blocks a purchase. */
export async function setSupplierCreditLimitInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: { supplierId: string; expectedVersion: number; creditLimit: string | null },
) {
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.suppliers
    set credit_limit = ${input.creditLimit},
        version = version + 1,
        updated_by = ${context.authority.membership.membershipId},
        updated_at = now()
    where tenant_id = ${context.tenantId}
      and id = ${input.supplierId}
      and version = ${input.expectedVersion}
    returning version
  `);
  if (!updated[0]) {
    const exists = await transaction.execute<{ id: string }>(sql`
      select id from app.suppliers where tenant_id = ${context.tenantId} and id = ${input.supplierId}
    `);
    if (!exists[0]) throw new AppError('NOT_FOUND', 'That supplier was not found');
    throw new AppError('CONFLICT', 'Someone else changed this supplier. Refresh and try again.');
  }
  return {
    supplierId: input.supplierId,
    creditLimit: input.creditLimit,
    version: Number(updated[0].version),
  };
}

export async function submitSupplierDocumentInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: {
    supplierId: string;
    documentType: SupplierDocumentType;
    referenceNumber: string;
    documentDate: string;
    dueDate?: string | undefined;
    paymentTerms?: 'CASH' | 'CREDIT' | undefined;
    creditPeriodDays?: number | undefined;
    amount: string;
    netAmount?: string | undefined;
    vatAmount?: string | undefined;
    lines?: readonly InvoiceLineInput[] | undefined;
    deliveryReferences?: readonly DeliveryLinkInput[] | undefined;
  },
) {
  await assertSupplierAndEntity(transaction, context, input.supplierId);
  const terms = resolveCreditTerms({
    documentType: input.documentType,
    documentDate: input.documentDate,
    paymentTerms: input.paymentTerms,
    creditPeriodDays: input.creditPeriodDays,
    dueDate: input.dueDate,
  });
  const validated = validateSupplierDocument({
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    supplierId: input.supplierId,
    documentType: input.documentType,
    referenceNumber: input.referenceNumber,
    documentDate: input.documentDate,
    ...(terms.dueDate === undefined ? {} : { dueDate: terms.dueDate }),
    currency: 'USD',
    amount: input.amount,
    deliveryReferences: (input.deliveryReferences ?? []).map((reference) => ({
      tenantId: context.tenantId,
      stationId: reference.stationId,
      deliveryId: reference.deliveryId,
      ...(reference.allocationId === undefined ? {} : { allocationId: reference.allocationId }),
    })),
  });
  if ((input.lines ?? []).length === 0 && (input.netAmount || input.vatAmount)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Net and VAT amounts can only be checked against invoice lines. Add the lines or remove the net and VAT amounts.',
    );
  }
  const prepared = await prepareSubmission(transaction, context, input, (totals) =>
    assertHeaderMatchesLines(
      { amount: input.amount, netAmount: input.netAmount, vatAmount: input.vatAmount },
      totals,
    ),
  );
  // Reference duplicate control applies to non-reversed documents only (migration 0038), so a
  // corrected invoice can reuse the reference of one that was reversed.
  const existing = await transaction.execute<{ id: string }>(sql`
    select id from app.supplier_documents
    where tenant_id = ${context.tenantId} and supplier_id = ${input.supplierId}
      and reference_number = ${validated.referenceNumber} and state <> 'REVERSED'
    limit 1
  `);
  if (existing[0]) {
    throw new AppError(
      'CONFLICT',
      `This supplier already has a document with reference ${validated.referenceNumber}. Use a different reference, or reverse the earlier document first if it was entered wrongly.`,
    );
  }
  const id = randomUUID();
  const actor = context.authority.membership.membershipId;
  await transaction.execute(sql`
    insert into app.supplier_documents (
      id, tenant_id, legal_entity_id, supplier_id, document_type,
      reference_number, document_date, due_date, currency, amount,
      net_amount, vat_amount, vat_mode, payment_terms, credit_period_days,
      state, version, created_by, submitted_by, submitted_at
    ) values (
      ${id}, ${context.tenantId}, ${context.legalEntityId}, ${input.supplierId},
      ${validated.documentType}, ${validated.referenceNumber}, ${validated.documentDate},
      ${validated.dueDate ?? null}, 'USD', ${validated.amount.amount.toString()},
      ${prepared.totals?.net ?? null}, ${prepared.totals?.vat ?? null},
      ${prepared.totals ? prepared.policy.vatMode : null},
      ${terms.paymentTerms}, ${terms.creditPeriodDays},
      'SUBMITTED', 0, ${actor}, ${actor}, now()
    )
  `);
  for (const reference of prepared.refs) {
    await transaction.execute(sql`
      insert into app.supplier_document_delivery_refs (
        id, tenant_id, legal_entity_id, station_id, supplier_document_id,
        delivery_id, allocation_id, linked_by, document_type,
        invoiced_quantity_litres, invoiced_amount
      ) values (
        ${reference.id}, ${context.tenantId}, ${context.legalEntityId}, ${reference.stationId},
        ${id}, ${reference.deliveryId}, ${reference.allocationId}, ${actor},
        ${validated.documentType}, ${reference.invoicedQuantityLitres}, ${reference.invoicedAmount}
      )
    `);
  }
  for (const line of prepared.lines) {
    await transaction.execute(sql`
      insert into app.supplier_document_lines (
        id, tenant_id, legal_entity_id, supplier_document_id, line_no, product_id, description,
        quantity, unit_price, net_amount, vat_rate, vat_amount, gross_amount, delivery_ref_id
      ) values (
        ${randomUUID()}, ${context.tenantId}, ${context.legalEntityId}, ${id}, ${line.lineNo},
        ${line.productId}, ${line.description}, ${line.quantity}, ${line.unitPrice},
        ${line.netAmount}, ${line.vatRate}, ${line.vatAmount}, ${line.grossAmount},
        ${prepared.lineRefIds.get(line.lineNo) ?? null}
      )
    `);
  }
  return {
    documentId: id,
    state: 'SUBMITTED' as const,
    amount: validated.amount.amount.toString(),
    netAmount: prepared.totals?.net ?? null,
    vatAmount: prepared.totals?.vat ?? null,
    vatMode: prepared.totals ? prepared.policy.vatMode : null,
    paymentTerms: terms.paymentTerms,
    creditPeriodDays: terms.creditPeriodDays,
    dueDate: validated.dueDate ?? null,
    lineCount: prepared.lines.length,
  };
}

export async function postSupplierDocumentInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: {
    documentId: string;
    expectedVersion: number;
    varianceApprovalReason?: string | undefined;
  },
) {
  // Fixed lock order (ADR-018 D6): referenced deliveries by id, then the document.
  const refs = await transaction.execute<PostedRef & { allocation_quantity: string | null }>(sql`
    select r.id, r.station_id, r.delivery_id, r.allocation_id, r.document_type,
           r.invoiced_quantity_litres::text, r.invoiced_amount::text,
           a.quantity_litres::text as allocation_quantity
    from app.supplier_document_delivery_refs r
    left join app.fuel_delivery_allocations a
      on a.tenant_id = r.tenant_id and a.id = r.allocation_id
    where r.tenant_id = ${context.tenantId} and r.supplier_document_id = ${input.documentId}
    order by r.delivery_id, r.id
  `);
  const deliveries = await lockDeliveries(
    transaction,
    context.tenantId,
    refs.map((ref) => ref.delivery_id),
  );
  const rows = await transaction.execute<DocumentRow>(sql`
    select id, tenant_id, legal_entity_id, supplier_id, document_type, reference_number,
           document_date, due_date, currency, amount, state, version, submitted_by
    from app.supplier_documents
    where tenant_id = ${context.tenantId}
      and legal_entity_id = ${context.legalEntityId}
      and id = ${input.documentId}
    for update
  `);
  const document = rows[0];
  if (!document) throw new AppError('NOT_FOUND', 'The supplier document was not found');
  if (Number(document.version) !== input.expectedVersion) {
    throw new AppError(
      'CONFLICT',
      'Someone else changed this supplier document. Refresh and try again.',
      {
        expectedVersion: input.expectedVersion,
        actualVersion: Number(document.version),
      },
    );
  }
  assertSupplierDocumentTransition(document.state as never, 'POSTED');

  const labels = new Map<string, string>();
  for (const ref of refs) {
    const delivery = assertDeliveryUsable(deliveries.get(ref.delivery_id), {
      supplierId: document.supplier_id,
      legalEntityId: document.legal_entity_id,
      stationId: ref.station_id,
    });
    labels.set(delivery.id, delivery.delivery_note_number);
  }
  if (document.document_type === 'INVOICE') {
    const conflict = await findCoverageConflict(transaction, {
      tenantId: context.tenantId,
      excludeDocumentId: document.id,
      links: refs.map((ref) => ({ deliveryId: ref.delivery_id, allocationId: ref.allocation_id })),
      deliveryLabels: labels,
    });
    if (conflict) throw conflict;
  }

  // Defence in depth: the lines (when present) must still add up to the payable header.
  const lines = await transaction.execute<{
    delivery_ref_id: string | null;
    quantity: string;
    net_amount: string;
    gross_amount: string;
  }>(sql`
    select delivery_ref_id, quantity::text, net_amount::text, gross_amount::text
    from app.supplier_document_lines
    where tenant_id = ${context.tenantId} and supplier_document_id = ${document.id}
  `);
  if (lines.length > 0) {
    const gross = lines.reduce(
      (sum, line) => sum.add(decimal(line.gross_amount)),
      new ExactDecimal('0'),
    );
    if (!gross.equals(decimal(document.amount))) {
      throw new AppError(
        'INVARIANT_VIOLATION',
        'This invoice no longer agrees with its lines, so it cannot be posted. Submit a corrected invoice.',
      );
    }
  }

  // Variance against the customizable policy (invoices only; a credit note is a reduction).
  let varianceStatus: 'NOT_EVALUATED' | 'WITHIN_TOLERANCE' | 'FLAGGED' | 'APPROVED' =
    'NOT_EVALUATED';
  let varianceSnapshot: unknown = null;
  let approvalReason: string | null = null;
  if (document.document_type === 'INVOICE' && refs.length > 0) {
    const policy = await loadPurchasingPolicy(transaction, context.tenantId, document.supplier_id);
    const evaluated = evaluateDocumentVariance({ policy, refs, deliveries, lines });
    const exceeded = evaluated.some((item) => item.result.invoiceExceeded);
    varianceSnapshot = {
      policySource: policy.source,
      action: policy.toleranceAction,
      deliveries: evaluated.map((item) => ({
        deliveryId: item.deliveryId,
        deliveryNoteNumber: item.deliveryNoteNumber,
        findings: item.result.findings,
        skipped: item.result.skipped,
      })),
    };
    if (!exceeded) {
      varianceStatus = 'WITHIN_TOLERANCE';
    } else if (policy.toleranceAction === 'FLAG') {
      varianceStatus = 'FLAGGED';
    } else {
      const reason = input.varianceApprovalReason?.trim();
      const messages = evaluated
        .flatMap((item) => item.result.findings)
        .filter((finding) => finding.severity === 'EXCEPTION')
        .map((finding) => finding.message);
      if (!reason) {
        throw new AppError(
          'CONFLICT',
          `This invoice is outside your purchasing tolerances and needs approval before it can be posted. ${messages.join(' ')} Review the differences, then post again with an approval reason.`,
          { varianceApprovalRequired: true, findings: messages },
        );
      }
      if (document.submitted_by === context.authority.membership.membershipId) {
        throw new AppError(
          'FORBIDDEN',
          'This invoice is outside your purchasing tolerances. Someone other than the person who submitted it must approve and post it.',
          { varianceApprovalRequired: true },
        );
      }
      varianceStatus = 'APPROVED';
      approvalReason = reason;
    }
  }

  await transaction.execute(sql`
    update app.supplier_documents
    set state = 'POSTED', posted_by = ${context.authority.membership.membershipId},
        posted_at = now(), version = version + 1, updated_at = now(),
        variance_status = ${varianceStatus},
        variance_snapshot = ${varianceSnapshot === null ? null : JSON.stringify(varianceSnapshot)}::jsonb,
        variance_approval_reason = ${approvalReason},
        variance_approved_by = ${approvalReason ? context.authority.membership.membershipId : null}
    where tenant_id = ${context.tenantId} and id = ${document.id}
      and version = ${input.expectedVersion}
  `);
  if (refs.length > 0) {
    try {
      await transaction.execute(sql`
        update app.supplier_document_delivery_refs
        set active = true
        where tenant_id = ${context.tenantId} and supplier_document_id = ${document.id}
      `);
    } catch (error) {
      if (uniqueViolationOf(error) !== null) {
        throw new AppError(
          'CONFLICT',
          'Another invoice was posted for the same delivery a moment ago. A delivery can only be invoiced once; refresh and review.',
        );
      }
      throw error;
    }
  }
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
  return {
    documentId: document.id,
    state: 'POSTED' as const,
    version: input.expectedVersion + 1,
    varianceStatus,
  };
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
           document_date, due_date, currency, amount, state, version, submitted_by
    from app.supplier_documents
    where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
      and id = ${input.documentId}
    for update
  `);
  const document = rows[0];
  if (!document) throw new AppError('NOT_FOUND', 'The supplier document was not found');
  if (Number(document.version) !== input.expectedVersion)
    throw new AppError(
      'CONFLICT',
      'Someone else changed this supplier document. Refresh and try again.',
    );
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
  // Reversal reopens the exposure: the delivery links stop covering their deliveries.
  await transaction.execute(sql`
    update app.supplier_document_delivery_refs
    set active = false, released_at = now()
    where tenant_id = ${context.tenantId} and supplier_document_id = ${document.id} and active
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
    throw new AppError(
      'CONFLICT',
      'Someone else changed this supplier payment. Refresh and try again.',
    );
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
    throw new AppError(
      'CONFLICT',
      'Someone else changed this supplier payment. Refresh and try again.',
    );
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
    throw new AppError(
      'CONFLICT',
      'Someone else changed this supplier payment. Refresh and try again.',
    );
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
