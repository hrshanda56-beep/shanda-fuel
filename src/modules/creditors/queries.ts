import 'server-only';

import { sql } from 'drizzle-orm';
import { authorize } from '../../platform/security/permissions';
import { withTenantTransaction } from '../../platform/db/transaction';
import { resolveSupplierCommandContext } from './application';

type SummaryRow = {
  supplier_id: string;
  code: string;
  legal_name: string;
  current: string;
  overdue: string;
  total: string;
};
type StatementRow = {
  source_id: string;
  movement_type: string;
  effective_date: string;
  posted_at: string;
  amount: string;
  running_balance: string;
};

function signedAmountSql() {
  return sql`case when movement_type in ('INVOICE', 'PAYMENT_REVERSAL') then amount else -amount end`;
}

export async function getSupplierSummaryFromRequest(
  request: Request,
  input: { tenantId: string; legalEntityId: string; supplierId?: string; asOf?: string },
) {
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
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
          and d.state <> 'REVERSED'
      ), document_totals as (
        select supplier_id,
          coalesce(sum(case when due_date is null or due_date >= ${asOf}
            then case when document_type = 'INVOICE' then balance else -balance end else 0 end), 0)::text as current,
          coalesce(sum(case when due_date < ${asOf}
            then case when document_type = 'INVOICE' then balance else -balance end else 0 end), 0)::text as overdue
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
        coalesce(m.total, '0') as total
      from app.suppliers s
      left join document_totals d on d.supplier_id = s.id
      left join movement_totals m on m.supplier_id = s.id
      where s.tenant_id = ${context.tenantId}
        ${input.supplierId ? sql`and s.id = ${input.supplierId}` : sql``}
      group by s.id, s.code, s.legal_name
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
      asOf,
    }));
  });
}

export async function getSupplierStatementFromRequest(
  request: Request,
  input: { tenantId: string; legalEntityId: string; supplierId: string },
) {
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'supplier.view',
    requestedScope: context.scope,
  });
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<StatementRow>(sql`
      select source_id, movement_type, effective_date, posted_at::text,
        amount::text, sum(${signedAmountSql()}) over (
          order by effective_date, posted_at, id
          rows between unbounded preceding and current row
        )::text as running_balance
      from app.supplier_account_movements
      where tenant_id = ${context.tenantId}
        and legal_entity_id = ${context.legalEntityId}
        and supplier_id = ${input.supplierId}
      order by effective_date, posted_at, id
    `);
    return rows.map((row) => ({
      sourceId: row.source_id,
      movementType: row.movement_type,
      effectiveDate: row.effective_date,
      postedAt: row.posted_at,
      amount: row.amount,
      runningBalance: row.running_balance,
      currency: 'USD' as const,
    }));
  });
}
