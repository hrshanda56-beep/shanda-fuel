import 'server-only';

import type { ContextSelection } from '../context';
import { isAuthorized } from '../../platform/security/permissions';
import { authorizeCashCommand, resolveCashCommandContext } from './application';
import { databaseForecourtTransactionPort } from '../forecourt/application';
import { getCashStationSummaryInTransaction } from './persistence';

export async function getCashStationSummaryFromRequest(
  request: Request,
  input: { selection: ContextSelection },
) {
  const context = await resolveCashCommandContext({
    request,
    selection: input.selection,
  });
  authorizeCashCommand(context, 'cash.collection.view');
  const canViewDeposits = isAuthorized({
    actor: context.authority.authorization,
    permissionCode: 'cash.deposit.view',
    requestedScope: context.scope,
  });
  const capabilities = {
    viewDeposits: canViewDeposits,
    recordCollection: isAuthorized({
      actor: context.authority.authorization,
      permissionCode: 'cash.collection.record',
      requestedScope: context.scope,
    }),
    receiveCollection: isAuthorized({
      actor: context.authority.authorization,
      permissionCode: 'cash.collection.receive',
      requestedScope: context.scope,
    }),
    recordDeposit: isAuthorized({
      actor: context.authority.authorization,
      permissionCode: 'cash.deposit.record',
      requestedScope: context.scope,
    }),
    confirmDeposit: isAuthorized({
      actor: context.authority.authorization,
      permissionCode: 'cash.deposit.confirm',
      requestedScope: context.scope,
    }),
  };
  return databaseForecourtTransactionPort.run(context, (transaction) =>
    getCashStationSummaryInTransaction(transaction, context, {
      includeDepositDetails: canViewDeposits,
      capabilities,
    }),
  );
}
