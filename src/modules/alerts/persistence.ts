import 'server-only';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDatabase } from '../../platform/db/client';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { withTenantTransaction } from '../../platform/db/transaction';
import type { EmailSender } from '../../platform/email';
import { loadActionCenterFacts } from '../approvals/action-center';
import { buildActionCenter } from '../approvals/action-center-model';
import { requireAuthenticatedActor } from '../identity/authenticated-actor';
import { runAsDigestRecipient, type DigestJobTicket } from '../identity/digest-actor';
import type { DigestPorts, DigestRecipient } from './run-digests';

/** The most people one run will email. A larger organisation is picked up on the next run. */
export const DIGEST_RECIPIENT_CAP = 200;

type RecipientRow = {
  tenant_id: string;
  legal_entity_id: string;
  station_id: string;
  station_name: string;
  membership_id: string;
  identity_id: string;
  email: string;
  display_name: string | null;
};

/**
 * Who to email: the one cross-organisation read (app.alert_digest_recipients, migration 0071).
 * Nothing about what they will be told is read here; that happens per person, as that person.
 */
export async function listDigestRecipients(
  limit: number = DIGEST_RECIPIENT_CAP,
): Promise<DigestRecipient[]> {
  const rows = await getDatabase().transaction((transaction) =>
    transaction.execute<RecipientRow>(sql`select * from app.alert_digest_recipients(${limit})`),
  );
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    legalEntityId: row.legal_entity_id,
    stationId: row.station_id,
    stationName: row.station_name,
    membershipId: row.membership_id,
    identityId: row.identity_id,
    email: row.email,
    name: row.display_name,
  }));
}

/** A database context for exactly this tenant, person and station; nothing wider. */
function contextFor(recipient: DigestRecipient) {
  return createTrustedTenantTransactionContext({
    tenantId: recipient.tenantId,
    actorId: recipient.identityId,
    membershipId: recipient.membershipId,
    legalEntityId: recipient.legalEntityId,
    stationId: recipient.stationId,
    requestId: randomUUID(),
  });
}

export function createDigestPorts(input: {
  ticket: DigestJobTicket;
  appUrl: string;
  sender: EmailSender;
  onFailure?: DigestPorts['onFailure'];
}): DigestPorts {
  return {
    appUrl: input.appUrl,
    ...(input.onFailure ? { onFailure: input.onFailure } : {}),

    // The existing, permission-filtered Action Center loaders, run as the recipient.
    loadAlerts: (recipient) =>
      runAsDigestRecipient(input.ticket, recipient.identityId, async () => {
        const request = new Request(`${input.appUrl.replace(/\/+$/, '')}/api/cron/alert-digests`);
        const actor = await requireAuthenticatedActor(request);
        const center = buildActionCenter(
          await loadActionCenterFacts(
            request,
            {
              organisationId: recipient.tenantId,
              legalEntityId: recipient.legalEntityId,
              stationId: recipient.stationId,
              allStations: false,
            },
            actor,
          ),
        );
        return { items: center.items, unavailable: center.unavailable };
      }),

    lastSentItemIds: (recipient) =>
      withTenantTransaction(contextFor(recipient), async (transaction) => {
        const rows = await transaction.execute<{ item_ids: string[] }>(sql`
          select item_ids from app.alert_deliveries
          where tenant_id = ${recipient.tenantId}
            and membership_id = ${recipient.membershipId}
            and station_id = ${recipient.stationId}
          order by sent_at desc
          limit 1
        `);
        return rows[0]?.item_ids ?? [];
      }),

    recordSent: (recipient, itemIds, messageId) =>
      withTenantTransaction(contextFor(recipient), async (transaction) => {
        await transaction.execute(sql`
          insert into app.alert_deliveries (tenant_id, membership_id, station_id, item_ids, message_id)
          values (
            ${recipient.tenantId}, ${recipient.membershipId}, ${recipient.stationId},
            ARRAY[${sql.join(
              itemIds.slice(0, 500).map((id) => sql`${id}`),
              sql`, `,
            )}]::text[],
            ${messageId}
          )
        `);
      }),

    send: (message) => input.sender.send(message),
  };
}
