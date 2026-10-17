import 'server-only';

import { isAuthorized } from '../../platform/security/permissions';
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
  const capabilities = {
    prepareHandover: isAuthorized({
      actor: context.authority.authorization,
      permissionCode: 'cash.handover.submit',
      requestedScope: context.scope,
    }),
    acceptHandover: isAuthorized({
      actor: context.authority.authorization,
      permissionCode: 'cash.handover.accept',
      requestedScope: context.scope,
    }),
    resolveHandover: isAuthorized({
      actor: context.authority.authorization,
      permissionCode: 'cash.handover.resolve',
      requestedScope: context.scope,
    }),
  };
  return databaseForecourtTransactionPort.run(context, (transaction) =>
    getCashStationSummaryInTransaction(transaction, context, { capabilities }),
  );
}
