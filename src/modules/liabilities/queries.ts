import 'server-only';

import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorizeLiabilityRead, resolveLiabilityReadContext } from './application';
import { formatMoney, sumExact } from '../reporting/domain';

export async function listApprovedLiabilitiesFromRequest(
  request: Request,
  input: { tenantId: string; legalEntityId?: string; stationId?: string; asOfDate?: string },
) {
  const authority = await resolveLiabilityReadContext(request, input.tenantId);
  authorizeLiabilityRead(authority, input.tenantId, input.legalEntityId, input.stationId);
  const asOfDate =
    input.asOfDate ??
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare' }).format(new Date());
  return withTenantTransaction(authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{
      liability_account_id: string;
      legal_entity_id: string;
      station_id: string | null;
      liability_kind: 'TRANSPORTER' | 'OTHER';
      counterparty_name: string;
      balance: string;
      due_date: string | null;
      last_effective_date: string;
    }>(sql`
      select liability_account_id, legal_entity_id, station_id, liability_kind, counterparty_name,
        sum(case when direction = 'INCREASE' then amount else -amount end)::text as balance,
        max(due_date) as due_date, max(effective_date) as last_effective_date
      from app.approved_liability_entries
      where tenant_id = ${input.tenantId}
        ${input.legalEntityId ? sql`and legal_entity_id = ${input.legalEntityId}` : sql``}
        ${input.stationId ? sql`and station_id = ${input.stationId}` : sql``}
        and effective_date <= ${asOfDate}
      group by liability_account_id, legal_entity_id, station_id, liability_kind, counterparty_name
      having sum(case when direction = 'INCREASE' then amount else -amount end) <> 0
      order by counterparty_name, liability_account_id
    `);
    return {
      asOfDate,
      currency: 'USD' as const,
      total: formatMoney(sumExact(rows.map((row) => row.balance))),
      rows: rows.map((row) => ({
        liabilityAccountId: row.liability_account_id,
        legalEntityId: row.legal_entity_id,
        stationId: row.station_id,
        liabilityKind: row.liability_kind,
        counterpartyName: row.counterparty_name,
        balance: formatMoney(row.balance),
        dueDate: row.due_date,
        lastEffectiveDate: row.last_effective_date,
      })),
    };
  });
}
