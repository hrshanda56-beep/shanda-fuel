import type { AuthenticatedActorContext } from '../identity';
import { resolveForecourtReadContext } from '../forecourt/read-context';
import 'server-only';

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
