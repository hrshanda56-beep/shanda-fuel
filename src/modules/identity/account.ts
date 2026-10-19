import 'server-only';
import { sql } from 'drizzle-orm';
import { getDatabase } from '../../platform/db';
import { AppError } from '../../platform/errors';
import { requireAuthenticatedActor } from './authenticated-actor';

/** Self-only account read; no tenant membership is required to read one's profile. */
export async function readAuthenticatedAccount(request: Request) {
  const actor = await requireAuthenticatedActor(request);
  return getDatabase().transaction(async (transaction) => {
    await transaction.execute(sql`select
      set_config('app.actor_id', ${actor.identityId}, true),
      set_config('app.tenant_id', '', true),
      set_config('app.membership_id', '', true),
      set_config('app.legal_entity_id', '', true),
      set_config('app.station_id', '', true),
      set_config('app.request_id', '', true)`);
    const rows = await transaction.execute<{ name: string; email: string | null }>(sql`
      select name,email from app.users where id=${actor.identityId} limit 1
    `);
    const account = rows[0];
    if (!account)
      throw new AppError(
        'FORBIDDEN',
        'Your application account is unavailable. Contact your administrator.',
      );
    return { user: { id: actor.identityId, ...account }, session: { userId: actor.identityId } };
  });
}
