import 'server-only';

import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import type { CustomerCommandContext, CustomerTransaction } from './application';
import { assertApproverAllowed } from './approver';
import { normaliseVoucher } from './entry-rules';
import type { CustomerEntryDetailsInput } from './validation';

/**
 * Writes the S13 details (vehicle, driver, voucher, approver, document) for one ledger entry.
 * One row per entry, written once; the ledger row itself is never touched.
 */
export async function insertCustomerEntryDetails(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: { ledgerEntryId: string; accountId: string; details: CustomerEntryDetailsInput },
): Promise<{ detailsId: string }> {
  const { details } = input;
  if (details.approvedByMembershipId) {
    await assertApproverAllowed(transaction, context, details.approvedByMembershipId);
  }
  if (details.documentId) {
    const document = await transaction.execute<{ id: string }>(sql`
      select id from app.documents
      where tenant_id = ${context.tenantId} and id = ${details.documentId}
    `);
    if (!document[0]) {
      throw new AppError('NOT_FOUND', 'The supporting document was not found.');
    }
  }
  if (details.voucherNumber) {
    // Owner default: a voucher can be used once per customer account. The lock keeps two
    // simultaneous entries with the same voucher from both passing the check.
    const voucher = normaliseVoucher(details.voucherNumber);
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`voucher:${context.tenantId}:${input.accountId}:${voucher}`}, 0))`,
    );
    const used = await transaction.execute<{ id: string }>(sql`
      select id from app.customer_ledger_entry_details
      where tenant_id = ${context.tenantId} and account_id = ${input.accountId}
        and upper(regexp_replace(btrim(voucher_number), '\s+', ' ', 'g')) = ${voucher}
      limit 1
    `);
    if (used[0]) {
      throw new AppError(
        'CONFLICT',
        `Voucher ${details.voucherNumber} has already been used on this account.`,
      );
    }
  }
  const existing = await transaction.execute<{ id: string }>(sql`
    select id from app.customer_ledger_entry_details
    where tenant_id = ${context.tenantId} and ledger_entry_id = ${input.ledgerEntryId}
  `);
  if (existing[0]) {
    throw new AppError(
      'CONFLICT',
      'Details were already recorded for this transaction. They cannot be changed.',
    );
  }
  const rows = await transaction.execute<{ id: string }>(sql`
    insert into app.customer_ledger_entry_details
      (tenant_id, ledger_entry_id, account_id, vehicle_registration, driver_name, voucher_number,
       approved_by_membership_id, document_id, recorded_by)
    values
      (${context.tenantId}, ${input.ledgerEntryId}, ${input.accountId},
       ${details.vehicleRegistration ?? null}, ${details.driverName ?? null},
       ${details.voucherNumber ?? null}, ${details.approvedByMembershipId ?? null},
       ${details.documentId ?? null}, ${context.authority.membership.membershipId})
    returning id
  `);
  return { detailsId: rows[0]!.id };
}
