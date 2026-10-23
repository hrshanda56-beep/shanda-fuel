import 'server-only';

import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import type { CustomerCommandContext, CustomerTransaction } from './application';
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
    const approver = await transaction.execute<{ id: string }>(sql`
      select id from app.memberships
      where tenant_id = ${context.tenantId} and id = ${details.approvedByMembershipId}
        and status = 'ACTIVE'
    `);
    if (!approver[0]) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The person who approved this is not an active member of your organisation.',
      );
    }
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
