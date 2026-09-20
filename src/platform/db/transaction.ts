import { sql } from 'drizzle-orm';
import { getDatabase, type Database } from './client';
import { assertTenantTransactionContext, type TenantTransactionContext } from './tenant-context';

export async function withTenantTransaction<T>(
  context: TenantTransactionContext,
  work: (transaction: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  assertTenantTransactionContext(context);
  const database = getDatabase();

  return database.transaction(async (transaction) => {
    // A1 will add the complete fail-closed RLS policy set. These local settings
    // reserve the stable seam and are scoped to this transaction only.
    await transaction.execute(sql`select set_config('app.tenant_id', ${context.tenantId}, true)`);
    await transaction.execute(sql`select set_config('app.actor_id', ${context.actorId}, true)`);
    if (context.legalEntityId) {
      await transaction.execute(
        sql`select set_config('app.legal_entity_id', ${context.legalEntityId}, true)`,
      );
    }
    if (context.stationId) {
      await transaction.execute(
        sql`select set_config('app.station_id', ${context.stationId}, true)`,
      );
    }
    return work(transaction);
  });
}
