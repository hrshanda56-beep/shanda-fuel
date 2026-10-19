import type { AuthenticatedActorContext } from '../identity';
import { resolveForecourtReadContext } from '../forecourt/read-context';
import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { authorizeSettlementCommand } from './application';
import { databaseForecourtTransactionPort } from '../forecourt/application';
import {
  getSettlementOverviewInTransaction,
  listProviderSettlementSummariesInTransaction,
  listUnmatchedProviderPaymentsInTransaction,
} from './persistence';

const contextSchema = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
});

export async function getProviderSettlementSummaryFromRequest(
  request: Request,
  input: { tenantId: string; stationId: string },
  authenticatedActor?: AuthenticatedActorContext,
) {
  const { context } = await resolveForecourtReadContext({
    request,
    tenantId: input.tenantId,
    stationId: input.stationId,
    authenticatedActor,
  });
  authorizeSettlementCommand(context, 'provider.settlement.view');
  return databaseForecourtTransactionPort.run(context, (transaction) =>
    listProviderSettlementSummariesInTransaction(transaction, context),
  );
}

export async function getUnmatchedProviderPaymentsFromRequest(
  request: Request,
  input: { tenantId: string; stationId: string },
  authenticatedActor?: AuthenticatedActorContext,
) {
  const { context } = await resolveForecourtReadContext({
    request,
    tenantId: input.tenantId,
    stationId: input.stationId,
    authenticatedActor,
  });
  authorizeSettlementCommand(context, 'provider.settlement.view');
  return databaseForecourtTransactionPort.run(context, (transaction) =>
    listUnmatchedProviderPaymentsInTransaction(transaction, context),
  );
}

export function parseSettlementQuery(input: unknown): { tenantId: string; stationId: string } {
  return contextSchema.parse(input);
}

export async function getSettlementOverviewFromRequest(
  request: Request,
  input: { tenantId: string; stationId: string },
  authenticatedActor?: AuthenticatedActorContext,
) {
  const { context } = await resolveForecourtReadContext({ request, ...input, authenticatedActor });
  authorizeSettlementCommand(context, 'provider.settlement.view');
  return databaseForecourtTransactionPort.run(context, (transaction) =>
    getSettlementOverviewInTransaction(transaction, context),
  );
}

export type ProviderAccountOption = {
  providerAccountId: string;
  providerName: string;
  displayName: string;
  accountReference: string;
  currency: string;
};

export type SettlementCapabilities = { record: boolean; allocate: boolean; reconcile: boolean };

function can(
  context: Parameters<typeof authorizeSettlementCommand>[0],
  code: Parameters<typeof authorizeSettlementCommand>[1],
) {
  try {
    authorizeSettlementCommand(context, code);
    return true;
  } catch {
    return false;
  }
}

/** Active provider accounts usable at this station, plus what the signed-in person may do. */
export async function getProviderAccountsFromRequest(
  request: Request,
  input: { tenantId: string; stationId: string },
  authenticatedActor?: AuthenticatedActorContext,
): Promise<{ accounts: ProviderAccountOption[]; capabilities: SettlementCapabilities }> {
  const { context } = await resolveForecourtReadContext({ request, ...input, authenticatedActor });
  authorizeSettlementCommand(context, 'provider.settlement.view');
  const capabilities = {
    record: can(context, 'provider.settlement.record'),
    allocate: can(context, 'provider.settlement.allocate'),
    reconcile: can(context, 'provider.settlement.reconcile'),
  };
  const accounts = capabilities.record
    ? await databaseForecourtTransactionPort.run(context, async (transaction) => {
        const rows = await transaction.execute<{
          id: string;
          provider_name: string;
          display_name: string;
          account_reference: string;
          currency: string;
        }>(sql`
          select a.id, p.name as provider_name, a.display_name, a.account_reference, a.currency
            from app.provider_accounts a
            join app.payment_providers p
              on p.tenant_id = a.tenant_id and p.id = a.provider_id
           where a.tenant_id = ${context.tenantId}
             and a.status = 'ACTIVE'
             and p.status = 'ACTIVE'
             and (a.station_id is null or a.station_id = ${context.stationId})
           order by p.name, a.display_name
        `);
        return rows.map((row) => ({
          providerAccountId: row.id,
          providerName: row.provider_name,
          displayName: row.display_name,
          accountReference: row.account_reference,
          currency: row.currency,
        }));
      })
    : [];
  return { accounts, capabilities };
}
