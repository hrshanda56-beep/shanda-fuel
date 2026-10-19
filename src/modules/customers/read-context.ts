import 'server-only';
import { randomUUID } from 'node:crypto';
import { resolveTenantReadAuthority } from '../context/read-authority';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { resolveCustomerCommandContext, withPlainAccessErrors } from './application';
import { resolveStationReadAuthority } from '../context/read-authority';
import type { CustomerCommandContext } from './application';
export async function resolveCustomerReadContext(input: {
  request: Request;
  requestedTenantId: string;
  stationId?: string;
}): Promise<CustomerCommandContext> {
  if (input.stationId) {
    const read = await withPlainAccessErrors(() =>
      resolveStationReadAuthority({
        request: input.request,
        tenantId: input.requestedTenantId,
        stationId: input.stationId!,
      }),
    );
    if (!read.station) return resolveCustomerCommandContext(input);
    const station = read.station;
    const transaction = createTrustedTenantTransactionContext({
      ...read.authority.transaction,
      legalEntityId: station.legalEntityId,
      stationId: station.id,
    });
    return {
      authority: { ...read.authority, transaction },
      tenantId: input.requestedTenantId,
      stationId: station.id,
      requestId: transaction.requestId ?? randomUUID(),
      scope: {
        tenantId: input.requestedTenantId,
        scopeType: 'STATION',
        legalEntityId: station.legalEntityId,
        stationId: station.id,
      },
    };
  }
  const { authority } = await withPlainAccessErrors(() =>
    resolveTenantReadAuthority({
      request: input.request,
      tenantId: input.requestedTenantId,
    }),
  );
  return {
    authority,
    tenantId: input.requestedTenantId,
    requestId: authority.transaction.requestId ?? randomUUID(),
    scope: { tenantId: input.requestedTenantId, scopeType: 'TENANT' },
  };
}
