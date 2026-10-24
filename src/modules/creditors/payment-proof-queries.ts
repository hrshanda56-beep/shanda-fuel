import 'server-only';

import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorize } from '../../platform/security/permissions';
import type { AuthenticatedActorContext } from '../identity';
import { paymentNeedsProofFlag } from './payment-proof';
import { resolveSupplierReadContext } from './read-context';

type PaymentRow = {
  id: string;
  payment_date: string;
  payment_reference: string;
  amount: string;
  state: string;
  proof_count: string | number;
};

/** States in which money is (or is about to be) paid, so a missing proof is worth flagging. */
const FLAGGED_STATES = new Set(['SUBMITTED', 'POSTED']);

/**
 * Every payment recorded for one supplier, newest first, with how many proof files it carries and
 * whether it is flagged (USD 1000 or more, no proof). Read-only.
 */
export async function listSupplierPaymentsWithProofFromRequest(
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
    const rows = await transaction.execute<PaymentRow>(sql`
      select p.id, p.payment_date, p.payment_reference, p.amount::text as amount, p.state,
        (select count(*) from app.documents d
          where d.tenant_id = p.tenant_id and d.subject_type = 'SUPPLIER_PAYMENT'
            and d.subject_id = p.id) as proof_count
      from app.supplier_payments p
      where p.tenant_id = ${context.tenantId}
        and p.legal_entity_id = ${context.legalEntityId}
        and p.supplier_id = ${input.supplierId}
      order by p.payment_date desc, p.created_at desc, p.id
    `);
    return rows.map((row) => {
      const proofCount = Number(row.proof_count);
      return {
        paymentId: row.id,
        paymentDate: row.payment_date,
        reference: row.payment_reference,
        amount: row.amount,
        currency: 'USD' as const,
        state: row.state,
        proofCount,
        needsProof: FLAGGED_STATES.has(row.state) && paymentNeedsProofFlag(row.amount, proofCount),
      };
    });
  });
}

export type SupplierPaymentWithProof = Awaited<
  ReturnType<typeof listSupplierPaymentsWithProofFromRequest>
>[number];
