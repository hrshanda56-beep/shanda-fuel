import 'server-only';

import { authorizeCashCommand, resolveCashCommandContext } from './application';
import { databaseForecourtTransactionPort } from '../forecourt/application';
import { getCashStationSummaryInTransaction } from './persistence';

export async function getCashStationSummaryFromRequest(
  request: Request,
  input: { tenantId: string; stationId: string },
) {
  const context = await resolveCashCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  authorizeCashCommand(context, 'cash.collection.view');
  return databaseForecourtTransactionPort.run(context, (transaction) =>
    getCashStationSummaryInTransaction(transaction, context),
  );
}
