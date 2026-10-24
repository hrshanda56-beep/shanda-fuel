import 'server-only';
import { sql } from 'drizzle-orm';
import type { AuthenticatedActorContext } from '../identity';
import { resolveTenantReadAuthority } from '../context/read-authority';
import { withTenantTransaction } from '../../platform/db/transaction';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { AppError } from '../../platform/errors';
import type { SupplierCommandContext } from './application';
export async function resolveSupplierReadContext(input: {
  request: Request;
  requestedTenantId: string;
  legalEntityId: string;
  authenticatedActor?: AuthenticatedActorContext;
}): Promise<SupplierCommandContext> {
  const { authority, rows } = await resolveTenantReadAuthority({
    request: input.request,
    tenantId: input.requestedTenantId,
    authenticatedActor: input.authenticatedActor,
  });
  let entityId = rows.find((row) => row.legal_entity_id === input.legalEntityId)?.legal_entity_id;
  if (!entityId) {
    const entities = await withTenantTransaction(authority.transaction, (tx) =>
      tx.execute<{ id: string }>(
        sql`select id from app.legal_entities where tenant_id=${input.requestedTenantId} and id=${input.legalEntityId} and status='ACTIVE' limit 1`,
      ),
    );
    entityId = entities[0]?.id;
  }
  if (!entityId) throw new AppError('NOT_FOUND', 'The requested legal entity was not found');
  const transaction = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId: entityId,
  });
  return {
    authority: { ...authority, transaction },
    tenantId: input.requestedTenantId,
    legalEntityId: entityId,
    requestId: transaction.requestId!,
    scope: {
      tenantId: input.requestedTenantId,
      scopeType: 'LEGAL_ENTITY',
      legalEntityId: entityId,
    },
  };
}
