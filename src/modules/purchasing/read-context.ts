import 'server-only';
import { resolveTenantReadAuthority } from '../context/read-authority';
import type { AuthenticatedActorContext } from '../identity';
import { bindPurchasingScope, type PurchasingCommandContext } from './application';

export async function resolvePurchasingReadContext(input: {
  request: Request;
  tenantId: string;
  legalEntityId?: string;
  stationId: string;
  authenticatedActor?: AuthenticatedActorContext;
}): Promise<PurchasingCommandContext> {
  const { authority } = await resolveTenantReadAuthority({
    request: input.request,
    tenantId: input.tenantId,
    authenticatedActor: input.authenticatedActor,
  });
  return bindPurchasingScope({
    authority,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    stationId: input.stationId,
  });
}
