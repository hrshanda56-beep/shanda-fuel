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
    // Every key is set, including absent optional values, so a pooled
    // connection can never retain a broader context from another command.
    await transaction.execute(
      sql`select set_config('app.tenant_id', ${validContext.tenantId}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.actor_id', ${validContext.actorId}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.membership_id', ${validContext.membershipId ?? ''}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.legal_entity_id', ${validContext.legalEntityId ?? ''}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.station_id', ${validContext.stationId ?? ''}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.request_id', ${validContext.requestId ?? ''}, true)`,
    );
    return work(transaction);
  });
}
