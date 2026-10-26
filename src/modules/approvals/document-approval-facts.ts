import 'server-only';
import { sql } from 'drizzle-orm';
import type { InventoryTransaction, InventoryCommandContext } from '../inventory/application';
import { isPermissionGranted, type PermissionCode } from '../../platform/security/permissions';
import { alternateApproverQuery } from '../../platform/security/separation-of-duties';
import { AppError } from '../../platform/errors';

/**
 * Prices, purchase orders and supplier invoices that are waiting on a person. Each queue is read
 * only when the person holds the permission to act on it, so a restricted queue is `null`.
 */
export async function loadDocumentApprovalFacts(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
) {
  const me = context.authority.authorization.membershipId;
  const may = (permissionCode: PermissionCode) =>
    isPermissionGranted({
      actor: context.authority.authorization,
      permissionCode,
      requestedScope: context.scope,
    });
  const canPrice = may('price.change.approve');
  const canOrder = may('purchase_order.approve');
  const canPost = may('supplier.document.post');
  const canExpense = may('expense.approve');
  if (!canPrice && !canOrder && !canPost && !canExpense) {
    return { prices: null, orders: null, invoices: null, expenses: null };
  }

  const empty = sql`select null as unavailable where false`;
  const alternate = (permission: string) =>
    alternateApproverQuery({
      tenantId: context.tenantId,
      stationId: context.stationId,
      excludeMembershipId: me,
      permission,
    });
  const prices = canPrice
    ? sql`
  select p.id, p.requested_by, p.unit_price::text as unit_price, pr.name as product_name
  from app.selling_prices p join app.products pr on pr.tenant_id=p.tenant_id and pr.id=p.product_id
  where p.tenant_id=${context.tenantId} and p.station_id=${context.stationId}
    and p.state='PENDING_APPROVAL'
  order by p.created_at,p.id`
    : empty;
  const orders = canOrder
    ? sql`
  select p.id, p.order_number, p.submitted_by, s.legal_name as supplier_name
  from app.purchase_orders p join app.suppliers s on s.tenant_id=p.tenant_id and s.id=p.supplier_id
  where p.tenant_id=${context.tenantId} and p.station_id=${context.stationId}
    and p.state='SUBMITTED'
  order by p.created_at,p.id`
    : empty;
  const invoices = canPost
    ? sql`
  select d.supplier_id, d.document_type, count(*)::int as count
  from app.supplier_documents d
  where d.tenant_id=${context.tenantId} and d.legal_entity_id=${context.legalEntityId}
    and d.state='SUBMITTED'
  group by d.supplier_id,d.document_type`
    : empty;

  const expenses = canExpense
    ? sql`
  select e.id, e.submitted_by, e.description, e.amount::text as amount
  from app.expenses e
  where e.tenant_id=${context.tenantId} and e.station_id=${context.stationId}
    and e.state='SUBMITTED'
  order by e.created_at,e.id`
    : empty;

  const rows = await transaction.execute<{
    prices: {
      id: string;
      requested_by: string | null;
      unit_price: string;
      product_name: string;
    }[];
    orders: {
      id: string;
      order_number: string;
      submitted_by: string | null;
      supplier_name: string;
    }[];
    invoices: { supplier_id: string; document_type: string; count: number }[];
    expenses: {
      id: string;
      submitted_by: string | null;
      description: string;
      amount: string;
    }[];
    other_price_approver: boolean;
    other_order_approver: boolean;
    other_expense_approver: boolean;
  }>(sql`
 with prices as (${prices}),orders as (${orders}),invoices as (${invoices}),expenses as (${expenses})
 select coalesce((select json_agg(prices) from prices),'[]'::json) as prices,
 coalesce((select json_agg(orders) from orders),'[]'::json) as orders,
 coalesce((select json_agg(invoices) from invoices),'[]'::json) as invoices,
 coalesce((select json_agg(expenses) from expenses),'[]'::json) as expenses,
 exists(${canPrice ? alternate('price.change.approve') : empty}) as other_price_approver,
 exists(${canOrder ? alternate('purchase_order.approve') : empty}) as other_order_approver,
 exists(${canExpense ? alternate('expense.approve') : empty}) as other_expense_approver
 `);
  const row = rows[0];
  if (!row) throw new AppError('INVARIANT_VIOLATION', 'Approval facts were not returned');
  return {
    prices: canPrice
      ? {
          rows: row.prices.map((p) => ({
            id: p.id,
            productName: p.product_name,
            unitPrice: p.unit_price,
            requestedByMe: p.requested_by === me,
          })),
          soleApprover: !row.other_price_approver,
        }
      : null,
    orders: canOrder
      ? {
          rows: row.orders.map((o) => ({
            id: o.id,
            orderNumber: o.order_number,
            supplierName: o.supplier_name,
            submittedByMe: o.submitted_by === me,
          })),
          soleApprover: !row.other_order_approver,
        }
      : null,
    expenses: canExpense
      ? {
          rows: row.expenses.map((e) => ({
            id: e.id,
            description: e.description,
            amount: e.amount,
            submittedByMe: e.submitted_by === me,
          })),
          soleApprover: !row.other_expense_approver,
        }
      : null,
    invoices: canPost
      ? {
          rows: row.invoices.map((i) => ({
            supplierId: i.supplier_id,
            documentType: i.document_type,
            count: i.count,
          })),
        }
      : null,
  };
}
