import 'server-only';
import type { AuthenticatedActorContext } from '../identity';
import { resolveStationReadAuthority } from '../context/read-authority';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { AppError } from '../../platform/errors';
import { createForecourtCommandContext } from './application';
import { loadForecourtStation } from './persistence';

/** Read authority avoids the command loader's station-discovery transaction. */
export async function resolveForecourtReadContext(input: {
  request: Request;
  tenantId: string;
  stationId: string;
  authenticatedActor?: AuthenticatedActorContext;
}) {
  const read = await resolveStationReadAuthority(input);
  const station = read.station ?? (await loadForecourtStation(read.authority, input.stationId));
  if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');
  const authority = {
    ...read.authority,
    transaction: createTrustedTenantTransactionContext({
      ...read.authority.transaction,
      legalEntityId: station.legalEntityId,
      stationId: station.id,
    }),
  };
  return {
    context: createForecourtCommandContext({ authority, station }),
    rows: read.rows,
    fromSnapshot: !!read.station,
  };
}
