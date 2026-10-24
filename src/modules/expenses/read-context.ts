import 'server-only';
import { resolveTenantReadAuthority } from '../context/read-authority';
import type { AuthenticatedActorContext } from '../identity';
import { bindExpenseScope, type ExpenseCommandContext } from './application';

export async function resolveExpenseReadContext(input: {
  request: Request;
  tenantId: string;
  legalEntityId?: string;
  stationId?: string;
  authenticatedActor?: AuthenticatedActorContext;
}): Promise<ExpenseCommandContext> {
  const { authority } = await resolveTenantReadAuthority({
    request: input.request,
    tenantId: input.tenantId,
    authenticatedActor: input.authenticatedActor,
  });
  return bindExpenseScope({
    authority,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    stationId: input.stationId,
  });
}
