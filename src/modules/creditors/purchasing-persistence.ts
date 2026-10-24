import 'server-only';

import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import type { SupplierCommandContext, SupplierTransaction } from './application';
import {
  BUILT_IN_PURCHASING_POLICY,
  computeInvoiceLine,
  resolvePurchasingPolicy,
  sumInvoiceLines,
  type ComputedInvoiceLine,
  type InvoiceLineInput,
  type PurchasingPolicyOverride,
  type PurchasingPolicyValues,
  type ResolvedPurchasingPolicy,
  validatePurchasingPolicyValues,
} from './purchasing-policy';
import { evaluateDeliveryVariance, type VarianceResult } from './variance';

/** postgres-js reports the failing constraint on the error or on its cause. */
export function uniqueViolationOf(error: unknown): string | null {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    const value = candidate as { code?: string; constraint_name?: string } | null | undefined;
    if (value?.code === '23505') return value.constraint_name ?? '';
  }
  return null;
}

export type PolicyRow = {
  id: string;
  supplier_id: string | null;
  quantity_tolerance_litres: string | null;
  quantity_tolerance_percent: string | null;
  price_tolerance_percent: string | null;
  amount_tolerance: string | null;
  over_receipt_tolerance_litres: string | null;
  over_receipt_tolerance_percent: string | null;
  tolerance_action: string | null;
  vat_mode: string | null;
  default_vat_rate: string | null;
  product_vat_rates: Record<string, string> | null;
  require_invoice_lines: boolean | null;
  version: number | string;
  updated_at: string;
};

const policyColumns = sql`id, supplier_id, quantity_tolerance_litres::text, quantity_tolerance_percent::text,
  price_tolerance_percent::text, amount_tolerance::text, over_receipt_tolerance_litres::text,
  over_receipt_tolerance_percent::text, tolerance_action, vat_mode, default_vat_rate::text,
  product_vat_rates, require_invoice_lines, version, updated_at::text`;

export function tenantValues(row: PolicyRow): PurchasingPolicyValues {
  return {
    quantityToleranceLitres: row.quantity_tolerance_litres,
    quantityTolerancePercent: row.quantity_tolerance_percent,
    priceTolerancePercent: row.price_tolerance_percent,
    amountTolerance: row.amount_tolerance,
    overReceiptToleranceLitres: row.over_receipt_tolerance_litres,
    overReceiptTolerancePercent: row.over_receipt_tolerance_percent,
    toleranceAction: (row.tolerance_action ??
      BUILT_IN_PURCHASING_POLICY.toleranceAction) as PurchasingPolicyValues['toleranceAction'],
    vatMode: (row.vat_mode ??
      BUILT_IN_PURCHASING_POLICY.vatMode) as PurchasingPolicyValues['vatMode'],
    defaultVatRate: row.default_vat_rate,
    productVatRates: row.product_vat_rates ?? {},
    requireInvoiceLines:
      row.require_invoice_lines ?? BUILT_IN_PURCHASING_POLICY.requireInvoiceLines,
  };
}

export function overrideValues(row: PolicyRow): PurchasingPolicyOverride {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== null && value !== undefined) out[key] = value;
  };
  set('quantityToleranceLitres', row.quantity_tolerance_litres);
  set('quantityTolerancePercent', row.quantity_tolerance_percent);
  set('priceTolerancePercent', row.price_tolerance_percent);
  set('amountTolerance', row.amount_tolerance);
  set('overReceiptToleranceLitres', row.over_receipt_tolerance_litres);
  set('overReceiptTolerancePercent', row.over_receipt_tolerance_percent);
  set('toleranceAction', row.tolerance_action);
  set('vatMode', row.vat_mode);
  set('defaultVatRate', row.default_vat_rate);
  set('requireInvoiceLines', row.require_invoice_lines);
  return out as PurchasingPolicyOverride;
}

export async function loadPolicyRows(
  transaction: SupplierTransaction,
  tenantId: string,
  supplierId?: string,
): Promise<{ tenant: PolicyRow | null; supplier: PolicyRow | null }> {
  const rows = await transaction.execute<PolicyRow>(sql`
    select ${policyColumns}
    from app.purchasing_policies
    where tenant_id = ${tenantId}
      and (supplier_id is null ${supplierId ? sql`or supplier_id = ${supplierId}` : sql``})
  `);
  return {
    tenant: rows.find((row) => row.supplier_id === null) ?? null,
    supplier: supplierId ? (rows.find((row) => row.supplier_id === supplierId) ?? null) : null,
  };
}

export async function loadPurchasingPolicy(
  transaction: SupplierTransaction,
  tenantId: string,
  supplierId: string,
): Promise<ResolvedPurchasingPolicy> {
  const { tenant, supplier } = await loadPolicyRows(transaction, tenantId, supplierId);
  return resolvePurchasingPolicy(
    tenant ? tenantValues(tenant) : null,
    supplier ? overrideValues(supplier) : null,
  );
}

export function policyView(row: PolicyRow) {
  return {
    policyId: row.id,
    supplierId: row.supplier_id,
    version: Number(row.version),
    quantityToleranceLitres: row.quantity_tolerance_litres,
    quantityTolerancePercent: row.quantity_tolerance_percent,
    priceTolerancePercent: row.price_tolerance_percent,
    amountTolerance: row.amount_tolerance,
    overReceiptToleranceLitres: row.over_receipt_tolerance_litres,
    overReceiptTolerancePercent: row.over_receipt_tolerance_percent,
    toleranceAction: row.tolerance_action,
    vatMode: row.vat_mode,
    defaultVatRate: row.default_vat_rate,
    productVatRates: row.product_vat_rates ?? {},
    requireInvoiceLines: row.require_invoice_lines,
    updatedAt: row.updated_at,
  };
}

export type SetPurchasingPolicyInput = {
  supplierId?: string | null | undefined;
  expectedVersion?: number | undefined;
  reason: string;
  quantityToleranceLitres?: string | null | undefined;
  quantityTolerancePercent?: string | null | undefined;
  priceTolerancePercent?: string | null | undefined;
  amountTolerance?: string | null | undefined;
  overReceiptToleranceLitres?: string | null | undefined;
  overReceiptTolerancePercent?: string | null | undefined;
  toleranceAction?: string | null | undefined;
  vatMode?: string | null | undefined;
  defaultVatRate?: string | null | undefined;
  productVatRates?: Record<string, string> | undefined;
  requireInvoiceLines?: boolean | null | undefined;
};

/**
 * Creates or replaces the tenant policy (supplierId null) or one supplier override. The write
 * is a full definition: omitted tolerances become "not configured" (zero tolerance). Tenant
 * rows always carry an action, VAT mode and the invoice-lines rule (defaults when omitted).
 * Product VAT overrides are kept when the field is omitted. Every version is snapshotted.
 */
export async function setPurchasingPolicyInTransaction(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: SetPurchasingPolicyInput,
) {
  const reason = input.reason.trim();
  if (!reason)
    throw new AppError('VALIDATION_FAILED', 'A reason for changing the policy is required.');
  const supplierId = input.supplierId ?? null;
  const values = validatePurchasingPolicyValues(input);
  if (supplierId !== null) {
    if (input.productVatRates && Object.keys(input.productVatRates).length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Product VAT rates are set for the whole tenant, not for a single supplier.',
      );
    }
    const supplier = await transaction.execute<{ id: string }>(sql`
      select id from app.suppliers where tenant_id = ${context.tenantId} and id = ${supplierId}
    `);
    if (!supplier[0]) throw new AppError('NOT_FOUND', 'That supplier is no longer available');
  }
  const rows = await transaction.execute<PolicyRow>(sql`
    select ${policyColumns}
    from app.purchasing_policies
    where tenant_id = ${context.tenantId}
      and ${supplierId === null ? sql`supplier_id is null` : sql`supplier_id = ${supplierId}`}
    for update
  `);
  const current = rows[0] ?? null;
  let productVatRates: Record<string, string> = current?.product_vat_rates ?? {};
  if (supplierId === null && input.productVatRates !== undefined) {
    productVatRates = values.productVatRates as Record<string, string>;
    const productIds = Object.keys(productVatRates);
    if (productIds.length > 0) {
      const found = await transaction.execute<{ id: string }>(sql`
        select id from app.products where tenant_id = ${context.tenantId}
          and id in (${sql.join(
            productIds.map((id) => sql`${id}`),
            sql`, `,
          )})
      `);
      if (found.length !== productIds.length) {
        throw new AppError(
          'NOT_FOUND',
          'One of the products you set a VAT rate for does not exist in this organisation.',
        );
      }
    }
  }
  const tenantLevel = supplierId === null;
  const action =
    values.toleranceAction ?? (tenantLevel ? BUILT_IN_PURCHASING_POLICY.toleranceAction : null);
  const vatMode = values.vatMode ?? (tenantLevel ? BUILT_IN_PURCHASING_POLICY.vatMode : null);
  const requireLines =
    values.requireInvoiceLines ??
    (tenantLevel ? BUILT_IN_PURCHASING_POLICY.requireInvoiceLines : null);
  const actor = context.authority.membership.membershipId;
  let policyId: string;
  let version: number;
  if (current) {
    if (input.expectedVersion === undefined) {
      throw new AppError(
        'CONFLICT',
        'A purchasing policy already exists. Reload it and send its version with your change.',
      );
    }
    if (Number(current.version) !== input.expectedVersion) {
      throw new AppError(
        'CONFLICT',
        'Someone else changed the purchasing policy. Reload it and try again.',
        { expectedVersion: input.expectedVersion, actualVersion: Number(current.version) },
      );
    }
    policyId = current.id;
    version = Number(current.version) + 1;
    await transaction.execute(sql`
      update app.purchasing_policies set
        quantity_tolerance_litres = ${values.quantityToleranceLitres},
        quantity_tolerance_percent = ${values.quantityTolerancePercent},
        price_tolerance_percent = ${values.priceTolerancePercent},
        amount_tolerance = ${values.amountTolerance},
        over_receipt_tolerance_litres = ${values.overReceiptToleranceLitres},
        over_receipt_tolerance_percent = ${values.overReceiptTolerancePercent},
        tolerance_action = ${action}, vat_mode = ${vatMode},
        default_vat_rate = ${values.defaultVatRate},
        product_vat_rates = ${JSON.stringify(productVatRates)}::jsonb,
        require_invoice_lines = ${requireLines},
        version = ${version}, updated_by = ${actor}, updated_at = now()
      where tenant_id = ${context.tenantId} and id = ${policyId}
    `);
  } else {
    if (input.expectedVersion !== undefined) {
      throw new AppError(
        'CONFLICT',
        'No purchasing policy exists yet. Send the change without a version to create it.',
      );
    }
    policyId = randomUUID();
    version = 0;
    try {
      await transaction.execute(sql`
        insert into app.purchasing_policies (
          id, tenant_id, supplier_id, quantity_tolerance_litres, quantity_tolerance_percent,
          price_tolerance_percent, amount_tolerance, over_receipt_tolerance_litres,
          over_receipt_tolerance_percent, tolerance_action, vat_mode, default_vat_rate,
          product_vat_rates, require_invoice_lines, version, updated_by
        ) values (
          ${policyId}, ${context.tenantId}, ${supplierId}, ${values.quantityToleranceLitres},
          ${values.quantityTolerancePercent}, ${values.priceTolerancePercent},
          ${values.amountTolerance}, ${values.overReceiptToleranceLitres},
          ${values.overReceiptTolerancePercent}, ${action}, ${vatMode}, ${values.defaultVatRate},
          ${JSON.stringify(productVatRates)}::jsonb, ${requireLines}, 0, ${actor}
        )
      `);
    } catch (error) {
      if (uniqueViolationOf(error) !== null) {
        throw new AppError(
          'CONFLICT',
          'Someone else just created this purchasing policy. Reload it and try again.',
        );
      }
      throw error;
    }
  }
  const snapshot = {
    supplierId,
    quantityToleranceLitres: values.quantityToleranceLitres,
    quantityTolerancePercent: values.quantityTolerancePercent,
    priceTolerancePercent: values.priceTolerancePercent,
    amountTolerance: values.amountTolerance,
    overReceiptToleranceLitres: values.overReceiptToleranceLitres,
    overReceiptTolerancePercent: values.overReceiptTolerancePercent,
    toleranceAction: action,
    vatMode,
    defaultVatRate: values.defaultVatRate,
    productVatRates,
    requireInvoiceLines: requireLines,
  };
  await transaction.execute(sql`
    insert into app.purchasing_policy_revisions (
      id, tenant_id, policy_id, version, snapshot, reason, changed_by
    ) values (
      ${randomUUID()}, ${context.tenantId}, ${policyId}, ${version},
      ${JSON.stringify(snapshot)}::jsonb, ${reason}, ${actor}
    )
  `);
  return { policyId, version, ...snapshot };
}

// ---------------------------------------------------------------------------------------
// Delivery links, lines and coverage
// ---------------------------------------------------------------------------------------

export type DeliveryLinkInput = {
  stationId: string;
  deliveryId: string;
  allocationId?: string | undefined;
  invoicedQuantityLitres?: string | undefined;
  invoicedAmount?: string | undefined;
};

export type DeliveryFacts = {
  id: string;
  station_id: string;
  status: string;
  supplier_id: string | null;
  product_id: string;
  delivery_note_number: string;
  note_quantity_litres: string;
  actual_quantity_litres: string;
  unit_landed_cost: string | null;
  legal_entity_id: string;
  /** Agreed price of the linked purchase-order line (ACTIVE link), when there is one. */
  po_unit_price?: string | null;
  po_number?: string | null;
};

/** Correlated lookups of the delivery's ACTIVE purchase-order link (at most one by index). */
export const purchaseOrderPriceColumns = sql`(
    select l.agreed_unit_price::text
    from app.purchase_order_delivery_links k
    join app.purchase_order_lines l
      on l.tenant_id = k.tenant_id and l.id = k.purchase_order_line_id
    where k.tenant_id = d.tenant_id and k.delivery_id = d.id and k.state = 'ACTIVE'
  ) as po_unit_price,
  (
    select o.order_number
    from app.purchase_order_delivery_links k
    join app.purchase_orders o on o.tenant_id = k.tenant_id and o.id = k.purchase_order_id
    where k.tenant_id = d.tenant_id and k.delivery_id = d.id and k.state = 'ACTIVE'
  ) as po_number`;

const deliveryColumns = sql`d.id, d.station_id, d.status, d.supplier_id, d.product_id,
  d.delivery_note_number, d.note_quantity_litres::text, d.actual_quantity_litres::text,
  d.unit_landed_cost::text, s.legal_entity_id, ${purchaseOrderPriceColumns}`;

/** Deliveries locked in id order: the fixed lock order shared by posting and correction. */
export async function lockDeliveries(
  transaction: SupplierTransaction,
  tenantId: string,
  deliveryIds: readonly string[],
): Promise<Map<string, DeliveryFacts>> {
  const ids = [...new Set(deliveryIds)].sort();
  const result = new Map<string, DeliveryFacts>();
  if (ids.length === 0) return result;
  const rows = await transaction.execute<DeliveryFacts>(sql`
    select ${deliveryColumns}
    from app.fuel_deliveries d
    join app.stations s on s.tenant_id = d.tenant_id and s.id = d.station_id
    where d.tenant_id = ${tenantId}
      and d.id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
    order by d.id
    for update of d
  `);
  for (const row of rows) result.set(row.id, row);
  return result;
}

async function readDeliveries(
  transaction: SupplierTransaction,
  tenantId: string,
  deliveryIds: readonly string[],
): Promise<Map<string, DeliveryFacts>> {
  const ids = [...new Set(deliveryIds)].sort();
  const result = new Map<string, DeliveryFacts>();
  if (ids.length === 0) return result;
  const rows = await transaction.execute<DeliveryFacts>(sql`
    select ${deliveryColumns}
    from app.fuel_deliveries d
    join app.stations s on s.tenant_id = d.tenant_id and s.id = d.station_id
    where d.tenant_id = ${tenantId}
      and d.id in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})
  `);
  for (const row of rows) result.set(row.id, row);
  return result;
}

export function assertDeliveryUsable(
  delivery: DeliveryFacts | undefined,
  input: { supplierId: string; legalEntityId: string; stationId?: string },
): DeliveryFacts {
  if (!delivery || (input.stationId && delivery.station_id !== input.stationId)) {
    throw new AppError(
      'NOT_FOUND',
      'A delivery on this invoice was not found. Check the delivery link and try again.',
    );
  }
  const label = `Delivery note ${delivery.delivery_note_number}`;
  if (delivery.legal_entity_id !== input.legalEntityId) {
    throw new AppError(
      'FORBIDDEN',
      `${label} belongs to a station of another legal entity, so it cannot be invoiced here.`,
    );
  }
  if (delivery.status !== 'CONFIRMED') {
    throw new AppError(
      'CONFLICT',
      `${label} has not been confirmed yet. Confirm the delivery before invoicing it.`,
    );
  }
  if (delivery.supplier_id === null) {
    throw new AppError(
      'CONFLICT',
      `${label} has no supplier recorded. Assign its supplier first (Correct delivery supplier), then link it to the invoice.`,
    );
  }
  if (delivery.supplier_id !== input.supplierId) {
    throw new AppError(
      'CONFLICT',
      `${label} was received from a different supplier, so it cannot be linked to this supplier's document. Pick the right delivery or supplier.`,
    );
  }
  return delivery;
}

type ActiveRef = {
  id: string;
  delivery_id: string;
  allocation_id: string | null;
  reference_number: string;
  document_id: string;
};

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Overlap rule: a whole-delivery link overlaps everything on that delivery. */
export function coverageOverlaps(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? NIL_UUID) === NIL_UUID || (right ?? NIL_UUID) === NIL_UUID || left === right;
}

export async function findCoverageConflict(
  transaction: SupplierTransaction,
  input: {
    tenantId: string;
    excludeDocumentId?: string;
    links: readonly { deliveryId: string; allocationId?: string | null }[];
    deliveryLabels: ReadonlyMap<string, string>;
  },
): Promise<AppError | null> {
  const deliveryIds = [...new Set(input.links.map((link) => link.deliveryId))];
  if (deliveryIds.length === 0) return null;
  const rows = await transaction.execute<ActiveRef>(sql`
    select r.id, r.delivery_id, r.allocation_id, d.reference_number, d.id as document_id
    from app.supplier_document_delivery_refs r
    join app.supplier_documents d on d.tenant_id = r.tenant_id and d.id = r.supplier_document_id
    where r.tenant_id = ${input.tenantId} and r.active and r.document_type = 'INVOICE'
      and r.delivery_id in (${sql.join(
        deliveryIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      ${input.excludeDocumentId ? sql`and r.supplier_document_id <> ${input.excludeDocumentId}` : sql``}
  `);
  for (const link of input.links) {
    const hit = rows.find(
      (row) =>
        row.delivery_id === link.deliveryId &&
        coverageOverlaps(row.allocation_id, link.allocationId),
    );
    if (hit) {
      return new AppError(
        'CONFLICT',
        `Delivery note ${input.deliveryLabels.get(link.deliveryId) ?? link.deliveryId} is already covered by posted invoice ${hit.reference_number}. A delivery can only be invoiced once. Reverse that invoice first, or record this one as a credit note.`,
        { deliveryId: link.deliveryId, coveredByDocumentId: hit.document_id },
      );
    }
  }
  return null;
}

export type PreparedSubmission = {
  policy: ResolvedPurchasingPolicy;
  lines: readonly ComputedInvoiceLine[];
  totals: { net: string; vat: string; gross: string } | null;
  /** Invoice line number to the id of the delivery link it belongs to. */
  lineRefIds: ReadonlyMap<number, string>;
  refs: readonly {
    id: string;
    stationId: string;
    deliveryId: string;
    allocationId: string | null;
    invoicedQuantityLitres: string | null;
    invoicedAmount: string | null;
  }[];
};

export async function prepareSubmission(
  transaction: SupplierTransaction,
  context: SupplierCommandContext,
  input: {
    supplierId: string;
    documentType: 'INVOICE' | 'CREDIT_NOTE';
    lines?: readonly InvoiceLineInput[] | undefined;
    deliveryReferences?: readonly DeliveryLinkInput[] | undefined;
  },
  assertHeader: (totals: { net: string; vat: string; gross: string }) => void,
): Promise<PreparedSubmission> {
  const policy = await loadPurchasingPolicy(transaction, context.tenantId, input.supplierId);
  const rawLines = input.lines ?? [];
  if (rawLines.length === 0 && policy.requireInvoiceLines) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Add the invoice lines (product or description, quantity and unit price) before submitting. Your purchasing policy requires every supplier invoice to carry its lines.',
    );
  }
  const lines = rawLines.map((line, index) => computeInvoiceLine(line, index + 1, policy));
  const totals = lines.length > 0 ? sumInvoiceLines(lines) : null;
  if (totals) assertHeader(totals);

  const links = input.deliveryReferences ?? [];
  const facts = await readDeliveries(
    transaction,
    context.tenantId,
    links.map((link) => link.deliveryId),
  );
  const labels = new Map<string, string>();
  for (const link of links) {
    const delivery = assertDeliveryUsable(facts.get(link.deliveryId), {
      supplierId: input.supplierId,
      legalEntityId: context.legalEntityId,
      stationId: link.stationId,
    });
    labels.set(delivery.id, delivery.delivery_note_number);
  }
  const refs = links.map((link) => ({
    id: randomUUID(),
    stationId: link.stationId,
    deliveryId: link.deliveryId,
    allocationId: link.allocationId ?? null,
    invoicedQuantityLitres: null as string | null,
    invoicedAmount: null as string | null,
    explicitQuantity: link.invoicedQuantityLitres,
    explicitAmount: link.invoicedAmount,
  }));
  // Lines that name a delivery attach to its link, and supply the invoiced facts.
  const lineRefIds = new Map<number, string>();
  for (const line of lines) {
    if (line.deliveryId === null) continue;
    const ref = refs.find(
      (candidate) =>
        candidate.deliveryId === line.deliveryId &&
        (candidate.allocationId ?? null) === (line.allocationId ?? null),
    );
    if (!ref) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Line ${line.lineNo} points at a delivery that is not linked to this invoice. Add that delivery under the invoice's delivery links first.`,
      );
    }
    const delivery = facts.get(line.deliveryId)!;
    if (line.productId !== null && delivery.product_id !== line.productId) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Line ${line.lineNo} is for a different product than delivery note ${delivery.delivery_note_number}.`,
      );
    }
    lineRefIds.set(line.lineNo, ref.id);
  }
  for (const ref of refs) {
    const linked = lines.filter((line) => lineRefIds.get(line.lineNo) === ref.id);
    if (linked.length > 0) {
      const quantity = linked.reduce((sum, line) => sum.add(line.quantity), new Decimal(0));
      const amount = linked.reduce((sum, line) => sum.add(line.netAmount), new Decimal(0));
      if (ref.explicitQuantity !== undefined && !new Decimal(ref.explicitQuantity).eq(quantity)) {
        throw new AppError(
          'VALIDATION_FAILED',
          `The litres you entered for delivery note ${labels.get(ref.deliveryId)} (${ref.explicitQuantity}) do not match its invoice lines (${quantity.toFixed(3)}).`,
        );
      }
      if (ref.explicitAmount !== undefined && !new Decimal(ref.explicitAmount).eq(amount)) {
        throw new AppError(
          'VALIDATION_FAILED',
          `The amount you entered for delivery note ${labels.get(ref.deliveryId)} (${ref.explicitAmount}) does not match its invoice lines (${amount.toFixed(4)}).`,
        );
      }
      ref.invoicedQuantityLitres = quantity.toFixed(3);
      ref.invoicedAmount = amount.toFixed(4);
    } else {
      ref.invoicedQuantityLitres =
        ref.explicitQuantity === undefined ? null : new Decimal(ref.explicitQuantity).toFixed(3);
      ref.invoicedAmount =
        ref.explicitAmount === undefined ? null : new Decimal(ref.explicitAmount).toFixed(4);
    }
  }
  if (input.documentType === 'INVOICE') {
    const conflict = await findCoverageConflict(transaction, {
      tenantId: context.tenantId,
      links: refs,
      deliveryLabels: labels,
    });
    if (conflict) throw conflict;
  }
  return {
    policy,
    lines,
    totals,
    lineRefIds,
    refs: refs.map((ref) => ({
      id: ref.id,
      stationId: ref.stationId,
      deliveryId: ref.deliveryId,
      allocationId: ref.allocationId,
      invoicedQuantityLitres: ref.invoicedQuantityLitres,
      invoicedAmount: ref.invoicedAmount,
    })),
  };
}

// ---------------------------------------------------------------------------------------
// Variance at posting
// ---------------------------------------------------------------------------------------

export type PostedRef = {
  id: string;
  station_id: string;
  delivery_id: string;
  allocation_id: string | null;
  document_type: string;
  invoiced_quantity_litres: string | null;
  invoiced_amount: string | null;
  allocation_quantity: string | null;
};

export type DeliveryVariance = {
  deliveryId: string;
  deliveryNoteNumber: string;
  result: VarianceResult;
};

export function evaluateDocumentVariance(input: {
  policy: ResolvedPurchasingPolicy;
  refs: readonly PostedRef[];
  deliveries: ReadonlyMap<string, DeliveryFacts>;
  lines: readonly { delivery_ref_id: string | null; quantity: string; net_amount: string }[];
}): DeliveryVariance[] {
  const byDelivery = new Map<string, PostedRef[]>();
  for (const ref of input.refs) {
    byDelivery.set(ref.delivery_id, [...(byDelivery.get(ref.delivery_id) ?? []), ref]);
  }
  const out: DeliveryVariance[] = [];
  for (const [deliveryId, refs] of byDelivery) {
    const delivery = input.deliveries.get(deliveryId)!;
    const wholeDelivery = refs.some((ref) => ref.allocation_id === null);
    const accepted = wholeDelivery
      ? delivery.actual_quantity_litres
      : refs
          .reduce((sum, ref) => sum.add(ref.allocation_quantity ?? '0'), new Decimal(0))
          .toFixed(3);
    const note = wholeDelivery ? delivery.note_quantity_litres : accepted;
    let invoicedQuantity: Decimal | null = null;
    let invoicedAmount: Decimal | null = null;
    let linkedQuantity = new Decimal(0);
    let linkedNet = new Decimal(0);
    for (const ref of refs) {
      if (ref.invoiced_quantity_litres !== null) {
        invoicedQuantity = (invoicedQuantity ?? new Decimal(0)).add(ref.invoiced_quantity_litres);
      }
      if (ref.invoiced_amount !== null) {
        invoicedAmount = (invoicedAmount ?? new Decimal(0)).add(ref.invoiced_amount);
      }
      for (const line of input.lines) {
        if (line.delivery_ref_id === ref.id) {
          linkedQuantity = linkedQuantity.add(line.quantity);
          linkedNet = linkedNet.add(line.net_amount);
        }
      }
    }
    const unitPrice = linkedQuantity.gt(0)
      ? linkedNet.div(linkedQuantity).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8)
      : null;
    out.push({
      deliveryId,
      deliveryNoteNumber: delivery.delivery_note_number,
      result: evaluateDeliveryVariance({
        noteQuantityLitres: note,
        acceptedQuantityLitres: accepted,
        invoicedQuantityLitres: invoicedQuantity?.toFixed(3) ?? null,
        invoicedUnitPrice: unitPrice,
        invoicedNetAmount: linkedQuantity.gt(0) ? linkedNet.toFixed(4) : null,
        referenceUnitCost: delivery.unit_landed_cost,
        purchaseOrderUnitPrice: delivery.po_unit_price ?? null,
        purchaseOrderNumber: delivery.po_number ?? null,
        deliveryLabel: delivery.delivery_note_number,
        policy: input.policy,
      }),
    });
  }
  return out.sort((a, b) => a.deliveryId.localeCompare(b.deliveryId));
}
