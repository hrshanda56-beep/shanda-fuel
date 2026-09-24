import 'server-only';

import { z } from 'zod';
import { authorizeSettlementCommand, resolveSettlementCommandContext } from './application';
import { databaseForecourtTransactionPort } from '../forecourt/application';
import {
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
) {
  const context = await resolveSettlementCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  authorizeSettlementCommand(context, 'provider.settlement.view');
  return databaseForecourtTransactionPort.run(context, (transaction) =>
    listProviderSettlementSummariesInTransaction(transaction, context),
  );
}

export async function getUnmatchedProviderPaymentsFromRequest(
  request: Request,
  input: { tenantId: string; stationId: string },
) {
  const context = await resolveSettlementCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  authorizeSettlementCommand(context, 'provider.settlement.view');
  return databaseForecourtTransactionPort.run(context, (transaction) =>
    listUnmatchedProviderPaymentsInTransaction(transaction, context),
  );
}

export function parseSettlementQuery(input: unknown): { tenantId: string; stationId: string } {
  return contextSchema.parse(input);
}
