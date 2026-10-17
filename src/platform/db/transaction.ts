import { sql } from 'drizzle-orm';
import { getDatabase, type Database } from './client';
import {
  assertTrustedTenantTransactionContext,
  type TenantTransactionContext,
} from './tenant-context';

export async function withTenantTransaction<T>(
  context: TenantTransactionContext,
  work: (transaction: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  assertTrustedTenantTransactionContext(context);
  const validContext = context;
  const database = getDatabase();

  return database.transaction(async (transaction) => {
    // The application may connect through an administrative local/CI role
    // that is a member of app_runtime. Enter the least-privileged runtime
    // role before any tenant context or domain work is performed so SECURITY
    // DEFINER capabilities cannot be reached from the administrative role.
    // In production DATABASE_URL is already app_runtime; SET LOCAL ROLE to
    // the current role remains valid and keeps both deployment shapes alike.
    await transaction.execute(sql`set local role app_runtime`);

    // Every key is set, including absent optional values, so a pooled
    // connection can never retain a broader context from another command.
    await transaction.execute(sql`
      select
        set_config('app.tenant_id', ${validContext.tenantId}, true),
        set_config('app.actor_id', ${validContext.actorId}, true),
        set_config('app.membership_id', ${validContext.membershipId ?? ''}, true),
        set_config('app.legal_entity_id', ${validContext.legalEntityId ?? ''}, true),
        set_config('app.station_id', ${validContext.stationId ?? ''}, true),
        set_config('app.request_id', ${validContext.requestId ?? ''}, true)
    `);
    return work(transaction);
  });
}
