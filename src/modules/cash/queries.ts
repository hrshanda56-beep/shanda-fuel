import type { AuthenticatedActorContext } from '../identity';
import { resolveForecourtReadContext } from '../forecourt/read-context';
import { filterAuthorizedContextRows } from '../context/queries';
import { validateContextSelection } from '../context/domain';
import { contextRoutePolicy } from '../context/routes';
import { AppError } from '../../platform/errors';
import 'server-only';

import type { ContextSelection } from '../context';
import { isAuthorized } from '../../platform/security/permissions';
import { authorizeCashCommand, resolveCashCommandContext } from './application';
import { databaseForecourtTransactionPort } from '../forecourt/application';
import { getCashStationSummaryInTransaction } from './persistence';

export async function getCashStationSummaryFromRequest(
  request: Request,
  input: { selection: ContextSelection },
  authenticatedActor?: AuthenticatedActorContext,
) {
  const { selection } = input;
  if (!selection.stationId || selection.allStations)
    throw new AppError('FORBIDDEN', 'One authorised station is required');
  const read = await resolveForecourtReadContext({
    request,
    tenantId: selection.organisationId,
    stationId: selection.stationId,
    authenticatedActor,
  });
  let context = read.context;
  if (read.fromSnapshot) {
    const available = filterAuthorizedContextRows(context.authority, read.rows);
    validateContextSelection(
      available,
      selection,
      contextRoutePolicy(`/stations/${selection.stationId}/cash`),
    );
  } else {
    context = await resolveCashCommandContext({ request, selection });
  }
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
    submitHandover: isAuthorized({
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
    getCashStationSummaryInTransaction(transaction, context, {
      includeDepositDetails: canViewDeposits,
      capabilities,
    }),
  );
}
