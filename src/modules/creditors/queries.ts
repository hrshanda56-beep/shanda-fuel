import 'server-only';

import { sql } from 'drizzle-orm';
import { authorize } from '../../platform/security/permissions';
import { withTenantTransaction } from '../../platform/db/transaction';
import type { AuthenticatedActorContext } from '../identity';
import { creditLimitPosition } from './credit-limit';
import { DEFAULT_DUE_SOON_DAYS } from './due-status';
import { paymentNeedsProofFlag } from './payment-proof';
import { resolveSupplierReadContext } from './read-context';

type SummaryRow = {
  supplier_id: string;
  code: string;
  legal_name: string;
  current: string;
  overdue: string;
  total: string;
  due_today: string;
  due_soon: string;
  overdue_1_7: string;
  overdue_8_14: string;
  overdue_15_30: string;
  overdue_over_30: string;
  credit_limit: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  default_credit_days: number | string | null;
  version: number | string;
};
type StatementRow = {
  source_id: string;
  movement_type: string;
  effective_date: string;
  posted_at: string;
  amount: string;
  running_balance: string;
  proof_count: string | number;
  source_type: string;
};

function signedAmountSql() {
  return sql`case when movement_type in ('INVOICE', 'PAYMENT_REVERSAL') then amount else -amount end`;
}

export async function getSupplierSummaryFromRequest(
  request: Request,
  input: {
    tenantId: string;
    legalEntityId: string;
    supplierId?: string;
    asOf?: string;
    /** Invoices due within this many days (after today) count as due soon. */
    dueSoonDays?: number;
  },
  authenticatedActor?: AuthenticatedActorContext,
) {
  const dueSoonDays = input.dueSoonDays ?? DEFAULT_DUE_SOON_DAYS;
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
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<SummaryRow>(sql`
      with document_balances as (
        select d.supplier_id, d.document_type, d.due_date,
          d.amount - coalesce(a.allocated_amount, 0) as balance
        from app.supplier_documents d
        left join (
          select a.document_id, sum(a.amount) as allocated_amount
          from app.supplier_payment_allocations a
          where a.tenant_id = ${context.tenantId} and a.state = 'POSTED'
            and not exists (select 1 from app.supplier_payment_allocations r
              where r.tenant_id = a.tenant_id and r.reversal_of_id = a.id and r.state = 'REVERSED')
          group by a.document_id
        ) a on a.document_id = d.id
        where d.tenant_id = ${context.tenantId}
          and d.legal_entity_id = ${context.legalEntityId}
          -- Same basis as the account movements behind the total: a document owes nothing
          -- until it is posted, so submitted ones are listed apart as waiting to be posted.
          and d.state in ('POSTED', 'PARTIALLY_PAID', 'PAID')
      ), document_totals as (
        select supplier_id,
          coalesce(sum(case when due_date is null or due_date >= ${asOf}
            then case when document_type = 'INVOICE' then balance else -balance end else 0 end), 0)::text as current,
          coalesce(sum(case when due_date < ${asOf}
            then case when document_type = 'INVOICE' then balance else -balance end else 0 end), 0)::text as overdue,
          coalesce(sum(case when due_date::date = ${asOf}::date
            then case when document_type = 'INVOICE' then balance else -balance end else 0 end), 0)::text as due_today,
          coalesce(sum(case when due_date::date > ${asOf}::date and due_date::date <= ${asOf}::date + ${dueSoonDays}::int
            then case when document_type = 'INVOICE' then balance else -balance end else 0 end), 0)::text as due_soon,
          coalesce(sum(case when ${asOf}::date - due_date::date between 1 and 7
            then case when document_type = 'INVOICE' then balance else -balance end else 0 end), 0)::text as overdue_1_7,
          coalesce(sum(case when ${asOf}::date - due_date::date between 8 and 14
            then case when document_type = 'INVOICE' then balance else -balance end else 0 end), 0)::text as overdue_8_14,
          coalesce(sum(case when ${asOf}::date - due_date::date between 15 and 30
            then case when document_type = 'INVOICE' then balance else -balance end else 0 end), 0)::text as overdue_15_30,
          coalesce(sum(case when ${asOf}::date - due_date::date > 30
            then case when document_type = 'INVOICE' then balance else -balance end else 0 end), 0)::text as overdue_over_30
        from document_balances
        group by supplier_id
      ), movement_totals as (
        select supplier_id,
          coalesce(sum(case when movement_type in ('INVOICE', 'PAYMENT_REVERSAL') then amount else -amount end), 0)::text as total
        from app.supplier_account_movements
        where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
        group by supplier_id
      )
      select s.id as supplier_id, s.code, s.legal_name,
        coalesce(d.current, '0') as current,
        coalesce(d.overdue, '0') as overdue,
        coalesce(d.due_today, '0') as due_today,
        coalesce(d.due_soon, '0') as due_soon,
        coalesce(d.overdue_1_7, '0') as overdue_1_7,
        coalesce(d.overdue_8_14, '0') as overdue_8_14,
        coalesce(d.overdue_15_30, '0') as overdue_15_30,
        coalesce(d.overdue_over_30, '0') as overdue_over_30,
        coalesce(m.total, '0') as total,
        s.credit_limit::text as credit_limit,
        s.contact_name, s.contact_phone, s.contact_email, s.default_credit_days,
        s.version
      from app.suppliers s
      left join document_totals d on d.supplier_id = s.id
      left join movement_totals m on m.supplier_id = s.id
      where s.tenant_id = ${context.tenantId}
        ${input.supplierId ? sql`and s.id = ${input.supplierId}` : sql``}
      order by s.code
    `);
    return rows.map((row) => ({
      supplierId: row.supplier_id,
      code: row.code,
      legalName: row.legal_name,
      currency: 'USD' as const,
      current: row.current,
      overdue: row.overdue,
      total: row.total,
      dueToday: row.due_today,
      dueSoon: row.due_soon,
      overdueAging: {
        days1To7: row.overdue_1_7,
        days8To14: row.overdue_8_14,
        days15To30: row.overdue_15_30,
        over30: row.overdue_over_30,
      },
      dueSoonDays,
      asOf,
      version: Number(row.version),
      creditLimit: creditLimitPosition(row.total, row.credit_limit),
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      contactEmail: row.contact_email,
      defaultCreditDays: row.default_credit_days === null ? null : Number(row.default_credit_days),
    }));
  });
}

export async function getSupplierStatementFromRequest(
  request: Request,
  input: { tenantId: string; legalEntityId: string; supplierId: string },
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
    const rows = await transaction.execute<StatementRow>(sql`
      select m.source_id, m.movement_type, m.effective_date, m.posted_at::text,
        m.amount::text, sum(${signedAmountSql()}) over (
          order by m.effective_date, m.posted_at, m.id
          rows between unbounded preceding and current row
        )::text as running_balance,
        m.source_type,
        (select count(*) from app.documents d
          where d.tenant_id = m.tenant_id and d.subject_type = 'SUPPLIER_PAYMENT'
            and d.subject_id = m.source_id and m.source_type = 'SUPPLIER_PAYMENT') as proof_count
      from app.supplier_account_movements m
      where m.tenant_id = ${context.tenantId}
        and m.legal_entity_id = ${context.legalEntityId}
        and m.supplier_id = ${input.supplierId}
      order by m.effective_date, m.posted_at, m.id
    `);
    return rows.map((row) => {
      // Proof only applies to money paid out; invoices, credit notes and reversals carry none.
      const isPayment = row.source_type === 'SUPPLIER_PAYMENT' && row.movement_type === 'PAYMENT';
      const proofCount = isPayment ? Number(row.proof_count) : null;
      return {
        sourceId: row.source_id,
        movementType: row.movement_type,
        effectiveDate: row.effective_date,
        postedAt: row.posted_at,
        amount: row.amount,
        runningBalance: row.running_balance,
        currency: 'USD' as const,
        proofCount,
        needsProof: proofCount === null ? false : paymentNeedsProofFlag(row.amount, proofCount),
      };
    });
  });
}

/** Invoices and credit notes that were entered but not posted, so nothing owes them yet. */
export async function getSupplierDocumentsAwaitingPostingFromRequest(
  request: Request,
  input: { tenantId: string; legalEntityId: string; supplierId: string },
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
    const rows = await transaction.execute<{
      id: string;
      document_type: string;
      reference_number: string;
      document_date: string;
      due_date: string | null;
      amount: string;
      version: number | string;
    }>(sql`
      select id, document_type, reference_number, document_date::text, due_date::text,
        amount::text, version
      from app.supplier_documents
      where tenant_id = ${context.tenantId}
        and legal_entity_id = ${context.legalEntityId}
        and supplier_id = ${input.supplierId}
        and state = 'SUBMITTED'
      order by document_date, created_at, id
    `);
    const payments = await transaction.execute<{
      id: string;
      payment_date: string;
      payment_reference: string;
      amount: string;
      version: number | string;
    }>(sql`
      select id, payment_date, payment_reference, amount::text, version
      from app.supplier_payments
      where tenant_id = ${context.tenantId}
        and legal_entity_id = ${context.legalEntityId}
        and supplier_id = ${input.supplierId}
        and state = 'SUBMITTED'
      order by payment_date, created_at, id
    `);
    return [
      ...rows.map((row) => ({
        kind: 'DOCUMENT' as const,
        id: row.id,
        documentType: row.document_type,
        referenceNumber: row.reference_number,
        documentDate: row.document_date,
        dueDate: row.due_date,
        amount: row.amount,
        currency: 'USD' as const,
        version: Number(row.version),
      })),
      ...payments.map((row) => ({
        kind: 'PAYMENT' as const,
        id: row.id,
        paymentDate: row.payment_date,
        referenceNumber: row.payment_reference,
        amount: row.amount,
        currency: 'USD' as const,
        version: Number(row.version),
      })),
    ];
  });
}

/**
 * The choices on the invoice form: the fuels the company sells, the stations of the company and,
 * for one supplier, the confirmed deliveries that no posted invoice covers yet.
 */
export async function getSupplierInvoiceChoicesFromRequest(
  request: Request,
  input: { tenantId: string; legalEntityId: string; supplierId?: string },
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
    const products = await transaction.execute<{ id: string; name: string }>(sql`
      select id, name from app.products
      where tenant_id = ${context.tenantId} and status = 'ACTIVE'
      order by name
    `);
    const stations = await transaction.execute<{ id: string; name: string }>(sql`
      select id, name from app.stations
      where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
      order by name
    `);
    const deliveries = input.supplierId
      ? await transaction.execute<{
          id: string;
          station_id: string;
          product_id: string;
          delivery_note_number: string;
          business_date: string;
          received: string;
          on_note: string;
        }>(sql`
          select d.id, d.station_id, d.product_id, d.delivery_note_number, d.business_date,
            d.actual_quantity_litres::text as received, d.note_quantity_litres::text as on_note
          from app.fuel_deliveries d
          join app.stations s on s.tenant_id = d.tenant_id and s.id = d.station_id
          where d.tenant_id = ${context.tenantId}
            and s.legal_entity_id = ${context.legalEntityId}
            and d.supplier_id = ${input.supplierId}
            and d.status = 'CONFIRMED'
            and not exists (
              select 1 from app.supplier_document_delivery_refs r
              where r.tenant_id = d.tenant_id and r.delivery_id = d.id
                and r.active and r.document_type = 'INVOICE')
          order by d.delivered_at desc, d.id
          limit 100
        `)
      : [];
    return {
      products: products.map((row) => ({ id: row.id, name: row.name })),
      stations: stations.map((row) => ({ id: row.id, name: row.name })),
      deliveries: deliveries.map((row) => ({
        id: row.id,
        stationId: row.station_id,
        productId: row.product_id,
        deliveryNoteNumber: row.delivery_note_number,
        businessDate: row.business_date,
        receivedLitres: row.received,
        noteLitres: row.on_note,
      })),
    };
  });
}
