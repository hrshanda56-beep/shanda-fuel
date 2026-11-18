import 'server-only';
import { resolveTenantReadAuthority } from '../context/read-authority';
import type { AuthenticatedActorContext } from '../identity';
import { bindSalesDocumentScope, type SalesDocumentContext } from './application';

export async function resolveSalesDocumentReadContext(input: {
  request: Request;
  tenantId: string;
  legalEntityId: string;
  authenticatedActor?: AuthenticatedActorContext;
}): Promise<SalesDocumentContext> {
  const { authority } = await resolveTenantReadAuthority({
    request: input.request,
    tenantId: input.tenantId,
    authenticatedActor: input.authenticatedActor,
  });
  return bindSalesDocumentScope({
    authority,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
}
