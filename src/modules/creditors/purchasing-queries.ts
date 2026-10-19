import 'server-only';

import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { authorize } from '../../platform/security/permissions';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import type { AuthenticatedActorContext } from '../identity';
import { resolveSupplierReadContext } from './read-context';
import {
  loadPolicyRows,
  overrideValues,
  policyView,
  tenantValues,
  type DeliveryFacts,
  type PostedRef,
  evaluateDocumentVariance,
  purchaseOrderPriceColumns,
} from './purchasing-persistence';
import { resolvePurchasingPolicy } from './purchasing-policy';
import {
  assessOverReceipt,
  classifyCoverage,
  evaluateDeliveryVariance,
  netBilledAmount,
  netBilledLitres,
  type CoverageState,
} from './variance';
import type { SupplierTransaction } from './application';

type ExposureInput = {
  tenantId: string;
  legalEntityId: string;
  /** A supplier id, or 'unassigned' for deliveries with no supplier recorded. */
  supplierId?: string | undefined;
  state?: CoverageState | undefined;
  asOf?: string | undefined;
};

type DeliveryRow = {
  id: string;
  station_id: string;
  station_code: string;
  supplier_id: string | null;
  supplier_code: string | null;
  supplier_name: string | null;
  product_id: string;
  delivery_note_number: string;
  business_date: string;
  note_quantity_litres: string;
  actual_quantity_litres: string;
  unit_landed_cost: string | null;
  total_landed_cost: string | null;
  po_unit_price: string | null;
  po_number: string | null;
};

type CoverageRow = {
  ref_id: string;
  delivery_id: string;
  allocation_id: string | null;
  document_type: 'INVOICE' | 'CREDIT_NOTE';
  invoiced_quantity_litres: string | null;
  invoiced_amount: string | null;
  allocation_quantity: string | null;
  document_id: string;
  reference_number: string;
  document_date: string;
  state: string;
};

const today = () => new Date().toISOString().slice(0, 10);

function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new AppError('VALIDATION_FAILED', 'The as-of date must be a valid date (YYYY-MM-DD).');
  }
  return value;
}

async function loadScope(
  transaction: SupplierTransaction,
  input: { tenantId: string; legalEntityId: string; supplierId?: string | undefined; asOf: string },
) {
  const supplierFilter =
    input.supplierId === undefined
      ? sql``
      : input.supplierId === 'unassigned'
        ? sql`and d.supplier_id is null`
        : sql`and d.supplier_id = ${input.supplierId}`;
  const deliveries = await transaction.execute<DeliveryRow>(sql`
    select d.id, d.station_id, st.code as station_code, d.supplier_id, s.code as supplier_code,
           s.legal_name as supplier_name, d.product_id, d.delivery_note_number, d.business_date,
           d.note_quantity_litres::text, d.actual_quantity_litres::text,
           d.unit_landed_cost::text, d.total_landed_cost::text,
           ${purchaseOrderPriceColumns}
    from app.fuel_deliveries d
    join app.stations st on st.tenant_id = d.tenant_id and st.id = d.station_id
    left join app.suppliers s on s.tenant_id = d.tenant_id and s.id = d.supplier_id
    where d.tenant_id = ${input.tenantId} and st.legal_entity_id = ${input.legalEntityId}
      and d.status = 'CONFIRMED' and d.business_date <= ${input.asOf}
      ${supplierFilter}
    order by d.business_date, d.delivery_note_number, d.id
  `);
  if (deliveries.length === 0) return { deliveries, coverage: [] as CoverageRow[] };
  // An invoice covers a delivery as of a date when it is dated on or before it and had not
  // yet been reversed (UTC date of the reversal). Reversal therefore reopens exposure from
  // the day it happens; earlier as-of dates still show the delivery as billed.
  const coverage = await transaction.execute<CoverageRow>(sql`
    select r.id as ref_id, r.delivery_id, r.allocation_id, r.document_type,
           r.invoiced_quantity_litres::text, r.invoiced_amount::text,
           a.quantity_litres::text as allocation_quantity,
           doc.id as document_id, doc.reference_number, doc.document_date, doc.state
    from app.supplier_document_delivery_refs r
    join app.supplier_documents doc on doc.tenant_id = r.tenant_id and doc.id = r.supplier_document_id
    left join app.fuel_delivery_allocations a on a.tenant_id = r.tenant_id and a.id = r.allocation_id
    join app.fuel_deliveries d on d.tenant_id = r.tenant_id and d.id = r.delivery_id
    join app.stations st on st.tenant_id = d.tenant_id and st.id = d.station_id
    where r.tenant_id = ${input.tenantId} and st.legal_entity_id = ${input.legalEntityId}
      and doc.posted_at is not null
      and doc.document_date <= ${input.asOf}
      and (doc.state <> 'REVERSED' or doc.reversed_at::date > ${input.asOf}::date)
      and r.delivery_id in (${sql.join(
        deliveries.map((delivery) => sql`${delivery.id}`),
        sql`, `,
      )})
    order by doc.document_date, doc.reference_number, r.id
  `);
  return { deliveries, coverage };
}

function coveredQuantity(ref: CoverageRow, accepted: string): Decimal {
  if (ref.invoiced_quantity_litres !== null) return new Decimal(ref.invoiced_quantity_litres);
  return new Decimal(ref.allocation_id === null ? accepted : (ref.allocation_quantity ?? '0'));
}

export async function getSupplierExposureFromRequest(
  request: Request,
  input: ExposureInput,
  authenticatedActor?: AuthenticatedActorContext,
) {
  const context = await resolveSupplierReadContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    authenticatedActor,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'supplier.creditor.review',
    requestedScope: context.scope,
  });
  const asOf = assertDate(input.asOf ?? today());
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const { deliveries, coverage } = await loadScope(transaction, {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      supplierId: input.supplierId,
      asOf,
    });
    const groups = new Map<
      string,
      {
        supplierId: string | null;
        code: string | null;
        legalName: string | null;
        supplierUnassigned: boolean;
        deliveries: Record<string, unknown>[];
        unbilledLitres: Decimal;
        unbilledValue: Decimal;
        unpricedUnbilledLitres: Decimal;
        counts: Record<CoverageState, number>;
      }
    >();
    for (const delivery of deliveries) {
      const accepted = delivery.actual_quantity_litres;
      const invoices = coverage.filter(
        (ref) => ref.delivery_id === delivery.id && ref.document_type === 'INVOICE',
      );
      const credits = coverage.filter(
        (ref) => ref.delivery_id === delivery.id && ref.document_type === 'CREDIT_NOTE',
      );
      const covered = invoices.reduce(
        (sum, ref) => sum.add(coveredQuantity(ref, accepted)),
        new Decimal(0),
      );
      const credited = credits.reduce(
        (sum, ref) => sum.add(coveredQuantity(ref, accepted)),
        new Decimal(0),
      );
      // Posted credit notes reduce what counts as billed (never below zero, shown if clamped).
      const net = netBilledLitres(covered.toFixed(), credited.toFixed());
      const netCovered = new Decimal(net.netLitres);
      const sumAmounts = (refs: CoverageRow[]) =>
        refs.every((ref) => ref.invoiced_amount !== null) && refs.length > 0
          ? refs.reduce((sum, ref) => sum.add(ref.invoiced_amount!), new Decimal(0)).toFixed(4)
          : null;
      const invoicedAmount = sumAmounts(invoices);
      const creditedAmount = sumAmounts(credits);
      const state = classifyCoverage(accepted, netCovered.toFixed(), invoices.length > 0);
      if (input.state && input.state !== state) continue;
      const unbilled = Decimal.max(new Decimal(accepted).sub(netCovered), new Decimal(0));
      const overBilled = Decimal.max(netCovered.sub(accepted), new Decimal(0));
      const priced = delivery.unit_landed_cost !== null;
      const unbilledValue = priced
        ? unbilled.mul(delivery.unit_landed_cost!).toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        : null;
      const key = delivery.supplier_id ?? 'unassigned';
      const group =
        groups.get(key) ??
        (() => {
          const created = {
            supplierId: delivery.supplier_id,
            code: delivery.supplier_code,
            legalName: delivery.supplier_name,
            supplierUnassigned: delivery.supplier_id === null,
            deliveries: [] as Record<string, unknown>[],
            unbilledLitres: new Decimal(0),
            unbilledValue: new Decimal(0),
            unpricedUnbilledLitres: new Decimal(0),
            counts: { UNBILLED: 0, PARTIALLY_BILLED: 0, BILLED: 0, OVER_BILLED: 0 } as Record<
              CoverageState,
              number
            >,
          };
          groups.set(key, created);
          return created;
        })();
      group.counts[state] += 1;
      group.unbilledLitres = group.unbilledLitres.add(unbilled);
      if (unbilledValue !== null) group.unbilledValue = group.unbilledValue.add(unbilledValue);
      else group.unpricedUnbilledLitres = group.unpricedUnbilledLitres.add(unbilled);
      group.deliveries.push({
        deliveryId: delivery.id,
        stationId: delivery.station_id,
        stationCode: delivery.station_code,
        deliveryNoteNumber: delivery.delivery_note_number,
        businessDate: delivery.business_date,
        state,
        acceptedLitres: new Decimal(accepted).toFixed(3),
        invoicedLitres: covered.toFixed(3),
        creditedLitres: credited.toFixed(3),
        // Billed after credit notes: invoiced minus credited, floored at zero.
        netBilledLitres: net.netLitres,
        invoicedAmount,
        creditedAmount,
        netBilledAmount: netBilledAmount(invoicedAmount, creditedAmount),
        creditExceedsInvoiced: net.creditExceedsInvoiced,
        unappliedCreditLitres: net.unappliedCreditLitres,
        unbilledLitres: unbilled.toFixed(3),
        overBilledLitres: overBilled.toFixed(3),
        // Valued only when a receipt cost has been recorded; otherwise "unpriced", never zero.
        valuation: priced ? 'PRICED' : 'UNPRICED',
        unitCost: delivery.unit_landed_cost,
        unbilledValue: unbilledValue === null ? null : unbilledValue.toFixed(4),
        invoices: invoices.map((ref) => ({
          documentId: ref.document_id,
          referenceNumber: ref.reference_number,
          documentDate: ref.document_date,
          invoicedLitres: coveredQuantity(ref, accepted).toFixed(3),
          invoicedAmount: ref.invoiced_amount,
        })),
        note: net.creditExceedsInvoiced
          ? `Credit notes cover ${net.unappliedCreditLitres} more litres than the invoices bill. The billed figure is held at zero; review the credit note with the supplier.`
          : state === 'OVER_BILLED'
            ? 'Invoices bill more litres than were received. Review this with the supplier; the delivery quantity is never changed by an invoice.'
            : state === 'UNBILLED' && !priced
              ? 'Received but not yet invoiced, and no receipt cost is recorded, so the value is unpriced (not zero).'
              : null,
      });
    }
    const suppliers = [...groups.values()]
      .sort((a, b) => (a.code ?? '￿').localeCompare(b.code ?? '￿'))
      .map((group) => ({
        supplierId: group.supplierId,
        code: group.code,
        legalName: group.supplierUnassigned ? 'Supplier unassigned' : group.legalName,
        supplierUnassigned: group.supplierUnassigned,
        unbilledLitres: group.unbilledLitres.toFixed(3),
        unbilledValue: group.unbilledValue.toFixed(4),
        unpricedUnbilledLitres: group.unpricedUnbilledLitres.toFixed(3),
        counts: group.counts,
        deliveries: group.deliveries,
      }));
    const sum = (pick: (group: (typeof suppliers)[number]) => string, places: number) =>
      suppliers.reduce((total, group) => total.add(pick(group)), new Decimal(0)).toFixed(places);
    return {
      asOf,
      currency: 'USD' as const,
      suppliers,
      totals: {
        unbilledLitres: sum((group) => group.unbilledLitres, 3),
        unbilledValue: sum((group) => group.unbilledValue, 4),
        unpricedUnbilledLitres: sum((group) => group.unpricedUnbilledLitres, 3),
      },
    };
  });
}

export async function getSupplierVarianceFromRequest(
  request: Request,
  input: ExposureInput & { deliveryId?: string | undefined; onlyExceptions?: boolean | undefined },
  authenticatedActor?: AuthenticatedActorContext,
) {
  const context = await resolveSupplierReadContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    authenticatedActor,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'supplier.creditor.review',
    requestedScope: context.scope,
  });
  const asOf = assertDate(input.asOf ?? today());
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const { deliveries: scope, coverage } = await loadScope(transaction, {
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      supplierId: input.supplierId,
      asOf,
    });
    const deliveries = input.deliveryId
      ? scope.filter((delivery) => delivery.id === input.deliveryId)
      : scope;
    const policyRows = await transaction.execute<{ supplier_id: string | null }>(sql`
      select supplier_id from app.purchasing_policies where tenant_id = ${context.tenantId}
    `);
    const tenantRows = await loadPolicyRows(transaction, context.tenantId);
    const supplierPolicies = new Map<string, ReturnType<typeof resolvePurchasingPolicy>>();
    const tenantPolicy = tenantRows.tenant ? tenantValues(tenantRows.tenant) : null;
    for (const row of policyRows) {
      if (row.supplier_id) {
        const rows = await loadPolicyRows(transaction, context.tenantId, row.supplier_id);
        supplierPolicies.set(
          row.supplier_id,
          resolvePurchasingPolicy(
            tenantPolicy,
            rows.supplier ? overrideValues(rows.supplier) : null,
          ),
        );
      }
    }
    const defaultPolicy = resolvePurchasingPolicy(tenantPolicy, null);
    const lineRows = coverage.length
      ? await transaction.execute<{
          delivery_ref_id: string | null;
          quantity: string;
          net_amount: string;
        }>(sql`
          select l.delivery_ref_id, l.quantity::text, l.net_amount::text
          from app.supplier_document_lines l
          where l.tenant_id = ${context.tenantId} and l.delivery_ref_id in (${sql.join(
            coverage.map((ref) => sql`${ref.ref_id}`),
            sql`, `,
          )})
        `)
      : [];
    const rows = deliveries.map((delivery) => {
      const policy =
        (delivery.supplier_id ? supplierPolicies.get(delivery.supplier_id) : undefined) ??
        defaultPolicy;
      const invoiceRefs = coverage.filter(
        (ref) => ref.delivery_id === delivery.id && ref.document_type === 'INVOICE',
      );
      const facts: DeliveryFacts = {
        id: delivery.id,
        station_id: delivery.station_id,
        status: 'CONFIRMED',
        supplier_id: delivery.supplier_id,
        product_id: delivery.product_id,
        delivery_note_number: delivery.delivery_note_number,
        note_quantity_litres: delivery.note_quantity_litres,
        actual_quantity_litres: delivery.actual_quantity_litres,
        unit_landed_cost: delivery.unit_landed_cost,
        legal_entity_id: context.legalEntityId,
        po_unit_price: delivery.po_unit_price,
        po_number: delivery.po_number,
      };
      const refs: PostedRef[] = invoiceRefs.map((ref) => ({
        id: ref.ref_id,
        station_id: delivery.station_id,
        delivery_id: delivery.id,
        allocation_id: ref.allocation_id,
        document_type: ref.document_type,
        invoiced_quantity_litres: ref.invoiced_quantity_litres,
        invoiced_amount: ref.invoiced_amount,
        allocation_quantity: ref.allocation_quantity,
      }));
      // With no invoice the receipt-side checks still run against a placeholder ref.
      const evaluated = evaluateDocumentVariance({
        policy,
        refs:
          refs.length > 0
            ? refs
            : [
                {
                  id: 'none',
                  station_id: delivery.station_id,
                  delivery_id: delivery.id,
                  allocation_id: null,
                  document_type: 'INVOICE',
                  invoiced_quantity_litres: null,
                  invoiced_amount: null,
                  allocation_quantity: null,
                },
              ],
        deliveries: new Map([[delivery.id, facts]]),
        lines: lineRows,
      })[0]!;
      const invoicedQuantity = refs.length
        ? refs.reduce<Decimal | null>(
            (sum, ref) =>
              ref.invoiced_quantity_litres === null
                ? sum
                : (sum ?? new Decimal(0)).add(ref.invoiced_quantity_litres),
            null,
          )
        : null;
      const creditRefs = coverage.filter(
        (ref) => ref.delivery_id === delivery.id && ref.document_type === 'CREDIT_NOTE',
      );
      const creditedLitres = creditRefs.reduce(
        (sum, ref) => sum.add(coveredQuantity(ref, delivery.actual_quantity_litres)),
        new Decimal(0),
      );
      const overReceipt = assessOverReceipt({
        noteQuantityLitres: delivery.note_quantity_litres,
        acceptedQuantityLitres: delivery.actual_quantity_litres,
        policy,
      });
      const findings = [...evaluated.result.findings];
      if (overReceipt.flagged && !findings.some((finding) => finding.code === 'OVER_RECEIPT')) {
        // Allocation-only invoice links compare the allocation, not the note; the delivery-level
        // over-receipt is still reported here.
        findings.push(
          ...evaluateDeliveryVariance({
            noteQuantityLitres: delivery.note_quantity_litres,
            acceptedQuantityLitres: delivery.actual_quantity_litres,
            invoicedQuantityLitres: null,
            invoicedUnitPrice: null,
            invoicedNetAmount: null,
            referenceUnitCost: null,
            deliveryLabel: delivery.delivery_note_number,
            policy,
          }).findings.filter((finding) => finding.code === 'OVER_RECEIPT'),
        );
      }
      const linked = lineRows.filter((line) => refs.some((ref) => ref.id === line.delivery_ref_id));
      const linkedQuantity = linked.reduce((sum, line) => sum.add(line.quantity), new Decimal(0));
      const linkedNet = linked.reduce((sum, line) => sum.add(line.net_amount), new Decimal(0));
      const invoicedUnitPrice = linkedQuantity.gt(0)
        ? linkedNet.div(linkedQuantity).toDecimalPlaces(8, Decimal.ROUND_HALF_UP)
        : null;
      return {
        deliveryId: delivery.id,
        deliveryNoteNumber: delivery.delivery_note_number,
        businessDate: delivery.business_date,
        supplierId: delivery.supplier_id,
        supplierUnassigned: delivery.supplier_id === null,
        noteLitres: new Decimal(delivery.note_quantity_litres).toFixed(3),
        acceptedLitres: new Decimal(delivery.actual_quantity_litres).toFixed(3),
        receivedVsNoteLitres: new Decimal(delivery.actual_quantity_litres)
          .sub(delivery.note_quantity_litres)
          .toFixed(3),
        invoicedLitres: invoicedQuantity?.toFixed(3) ?? null,
        invoicedVsAcceptedLitres: invoicedQuantity
          ? invoicedQuantity.sub(delivery.actual_quantity_litres).toFixed(3)
          : null,
        invoicedUnitPrice: invoicedUnitPrice?.toFixed(8) ?? null,
        receiptUnitCost: delivery.unit_landed_cost,
        // The price the invoice is judged against: the linked PO line's agreed price when it has
        // one, otherwise the recorded receipt cost. priceBasis names which was used.
        purchaseOrderNumber: delivery.po_number,
        purchaseOrderUnitPrice: delivery.po_unit_price,
        priceBasis: evaluated.result.priceBasis,
        priceDifference:
          invoicedUnitPrice && evaluated.result.priceBasis !== null
            ? invoicedUnitPrice
                .sub(
                  evaluated.result.priceBasis === 'PURCHASE_ORDER'
                    ? delivery.po_unit_price!
                    : delivery.unit_landed_cost!,
                )
                .toFixed(8)
            : null,
        creditedLitres: creditedLitres.toFixed(3),
        overReceipt: overReceipt.flagged ? overReceipt : null,
        overReceiptReviewRequired: overReceipt.reviewRequired,
        policySource: policy.source,
        toleranceAction: policy.toleranceAction,
        exceeded: findings.some((finding) => finding.severity === 'EXCEPTION'),
        findings,
        reasons: findings.map((finding) => finding.message),
        skipped: evaluated.result.skipped,
      };
    });
    return {
      asOf,
      deliveries: input.onlyExceptions ? rows.filter((row) => row.exceeded) : rows,
    };
  });
}

export async function getPurchasingPolicyFromRequest(
  request: Request,
  input: { tenantId: string; legalEntityId: string; supplierId?: string | undefined },
  authenticatedActor?: AuthenticatedActorContext,
) {
  const context = await resolveSupplierReadContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    authenticatedActor,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'supplier.view',
    requestedScope: context.scope,
  });
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const { tenant, supplier } = await loadPolicyRows(
      transaction,
      context.tenantId,
      input.supplierId,
    );
    const overrides = await transaction.execute<{ supplier_id: string }>(sql`
      select supplier_id from app.purchasing_policies
      where tenant_id = ${context.tenantId} and supplier_id is not null
      order by supplier_id
    `);
    const resolved = resolvePurchasingPolicy(
      tenant ? tenantValues(tenant) : null,
      supplier ? overrideValues(supplier) : null,
    );
    return {
      /** False until an administrator saves a policy: strict tolerances, no VAT, lines required. */
      configured: tenant !== null,
      tenantPolicy: tenant ? policyView(tenant) : null,
      supplierOverride: supplier ? policyView(supplier) : null,
      suppliersWithOverrides: overrides.map((row) => row.supplier_id),
      resolved,
    };
  });
}
