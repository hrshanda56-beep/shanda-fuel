import 'server-only';

import { sql } from 'drizzle-orm';
import { authorize } from '../../platform/security/permissions';
import { withTenantTransaction } from '../../platform/db/transaction';
import type { AuthenticatedActorContext } from '../identity';
import { buildDueSchedule, type DueInvoice } from './due-schedule';
import { resolveSupplierReadContext } from './read-context';

type DueRow = {
  document_id: string;
  supplier_id: string;
  legal_name: string;
  reference_number: string;
  document_date: string;
  due_date: string | null;
  payment_terms: 'CASH' | 'CREDIT' | null;
  credit_period_days: number | string | null;
  balance: string;
};

/**
 * Unpaid supplier invoices for one legal entity, grouped by when they fall due (overdue, next 7,
 * 8 to 14 and 15 to 30 days). Same permission and tenant scope as the supplier summary. Cash
 * purchases are left out: they are settled when bought. Credit notes are not listed here; they
 * reduce the supplier balance on the supplier pages.
 */
export async function getSupplierDueScheduleFromRequest(
  request: Request,
  input: { tenantId: string; legalEntityId: string; supplierId?: string; asOf?: string },
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
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  const rows = await withTenantTransaction(context.authority.transaction, (transaction) =>
    transaction.execute<DueRow>(sql`
      select d.id as document_id, d.supplier_id, s.legal_name, d.reference_number,
             d.document_date, d.due_date, d.payment_terms, d.credit_period_days,
             (d.amount - coalesce(a.allocated_amount, 0))::text as balance
      from app.supplier_documents d
      join app.suppliers s on s.tenant_id = d.tenant_id and s.id = d.supplier_id
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
        and d.document_type = 'INVOICE'
        and d.state in ('POSTED', 'PARTIALLY_PAID')
        and coalesce(d.payment_terms, 'CREDIT') <> 'CASH'
        ${input.supplierId ? sql`and d.supplier_id = ${input.supplierId}` : sql``}
    `),
  );
  const invoices: DueInvoice[] = rows.map((row) => ({
    documentId: row.document_id,
    supplierId: row.supplier_id,
    supplierName: row.legal_name,
    referenceNumber: row.reference_number,
    documentDate: row.document_date,
    dueDate: row.due_date,
    paymentTerms: row.payment_terms,
    creditPeriodDays: row.credit_period_days === null ? null : Number(row.credit_period_days),
    balance: row.balance,
  }));
  return { currency: 'USD' as const, ...buildDueSchedule(invoices, asOf) };
}
