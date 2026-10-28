import 'server-only';
import { sql } from 'drizzle-orm';
import type { InventoryTransaction, InventoryCommandContext } from '../inventory/application';
import { isPermissionGranted, type PermissionCode } from '../../platform/security/permissions';
import { alternateApproverQuery } from '../../platform/security/separation-of-duties';
import { AppError } from '../../platform/errors';

/**
 * Prices, purchase orders, supplier invoices and supplier payments that are waiting on a person.
 * Each queue is read only when the person holds the permission to act on it, so a restricted queue
 * is `null`.
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
  const canPostPayment = may('supplier.payment.post');
  const canExpense = may('expense.approve');
  if (!canPrice && !canOrder && !canPost && !canPostPayment && !canExpense) {
    return { prices: null, orders: null, invoices: null, expenses: null, supplierPayments: null };
  }

  const empty = sql`select null as unavailable where false`;
  const alternate = () =>
    alternateApproverQuery({
      tenantId: context.tenantId,
      stationId: context.stationId,
      excludeMembershipId: me,
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
  const supplierPayments = canPostPayment
    ? sql`
  select p.id, p.supplier_id, s.legal_name as supplier_name, p.payment_reference,
         p.amount::text as amount, p.submitted_by
  from app.supplier_payments p
  join app.suppliers s on s.tenant_id=p.tenant_id and s.id=p.supplier_id
  where p.tenant_id=${context.tenantId} and p.legal_entity_id=${context.legalEntityId}
    and p.state='SUBMITTED'
  order by p.payment_date,p.created_at,p.id`
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
    supplierPayments: {
      id: string;
      supplier_id: string;
      supplier_name: string;
      payment_reference: string;
      amount: string;
      submitted_by: string | null;
    }[];
    other_price_approver: boolean;
    other_order_approver: boolean;
    other_expense_approver: boolean;
    other_payment_approver: boolean;
  }>(sql`
 with prices as (${prices}),orders as (${orders}),invoices as (${invoices}),expenses as (${expenses}),supplier_payments as (${supplierPayments})
 select coalesce((select json_agg(prices) from prices),'[]'::json) as prices,
 coalesce((select json_agg(orders) from orders),'[]'::json) as orders,
 coalesce((select json_agg(invoices) from invoices),'[]'::json) as invoices,
 coalesce((select json_agg(expenses) from expenses),'[]'::json) as expenses,
 coalesce((select json_agg(supplier_payments) from supplier_payments),'[]'::json) as "supplierPayments",
 exists(${canPrice ? alternate() : empty}) as other_price_approver,
 exists(${canOrder ? alternate() : empty}) as other_order_approver,
 exists(${canExpense ? alternate() : empty}) as other_expense_approver
 ,exists(${canPostPayment ? alternate() : empty}) as other_payment_approver
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
    supplierPayments: canPostPayment
      ? {
          rows: row.supplierPayments.map((p) => ({
            id: p.id,
            supplierId: p.supplier_id,
            supplierName: p.supplier_name,
            paymentReference: p.payment_reference,
            amount: p.amount,
            submittedByMe: p.submitted_by === me,
          })),
          soleApprover: !row.other_payment_approver,
        }
      : null,
  };
}
