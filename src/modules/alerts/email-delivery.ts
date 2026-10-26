import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getServerEnv, type ServerEnv } from '../../platform/config/env';
import { getDatabase } from '../../platform/db';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { withTenantTransaction } from '../../platform/db/transaction';
import { createLogger } from '../../platform/logging';
import { createResendEmailSender, type EmailSender } from '../../platform/email';
import { buildActionCenter } from '../approvals/action-center-model';
import { loadActionCenterFacts } from '../approvals/action-center';
import { runDigests, type DigestRecipient, type DigestRunResult } from './run-digests';
import type { AuthenticatedActorContext } from '../identity';

const logger = createLogger({ component: 'alerts.email-delivery' });
const RECIPIENT_LIMIT = 500;
const CLAIM_MINUTES = 15;

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

/** The scheduled job gets only the narrow, migration-owned recipient projection. */
export async function loadAlertEmailRecipients(
  limit = RECIPIENT_LIMIT,
): Promise<readonly DigestRecipient[]> {
  const rows = await getDatabase().execute<RecipientRow>(sql`
    select tenant_id, legal_entity_id, station_id, station_name, membership_id,
      identity_id, email, display_name
    from app.alert_email_recipients(${Math.max(0, Math.min(limit, RECIPIENT_LIMIT))})
  `);
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

function digestKey(itemIds: readonly string[]): string {
  return itemIds.join('\u001f');
}

function recipientContext(recipient: DigestRecipient) {
  if (!recipient.legalEntityId) throw new Error('Alert recipient has no legal-entity scope');
  return createTrustedTenantTransactionContext({
    tenantId: recipient.tenantId,
    actorId: recipient.identityId,
    membershipId: recipient.membershipId,
    legalEntityId: recipient.legalEntityId,
    stationId: recipient.stationId,
    requestId: randomUUID(),
  });
}

async function readLastSentItemIds(recipient: DigestRecipient): Promise<readonly string[]> {
  return withTenantTransaction(recipientContext(recipient), async (transaction) => {
    const rows = await transaction.execute<{ item_ids: unknown }>(sql`
      select item_ids
      from app.alert_email_deliveries
      where tenant_id = ${recipient.tenantId}
        and membership_id = ${recipient.membershipId}
        and station_id = ${recipient.stationId}
        and state = 'SENT'
      order by sent_at desc, id desc
      limit 1
    `);
    const value = rows[0]?.item_ids;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  });
}

async function claimDigest(
  recipient: DigestRecipient,
  itemIds: readonly string[],
): Promise<boolean> {
  const key = digestKey(itemIds);
  return withTenantTransaction(recipientContext(recipient), async (transaction) => {
    const rows = await transaction.execute<{ id: string }>(sql`
      insert into app.alert_email_deliveries (
        tenant_id, membership_id, station_id, digest_key, item_ids, state,
        claimed_at, claim_expires_at, updated_at
      ) values (
        ${recipient.tenantId}, ${recipient.membershipId}, ${recipient.stationId},
        ${key}, ${JSON.stringify(itemIds)}::jsonb, 'CLAIMED', now(),
        now() + (${CLAIM_MINUTES} * interval '1 minute'), now()
      )
      on conflict (tenant_id, membership_id, station_id, digest_key) do update
        set item_ids = excluded.item_ids,
            state = 'CLAIMED',
            claimed_at = now(),
            claim_expires_at = excluded.claim_expires_at,
            provider_message_id = null,
            sent_at = null,
            updated_at = now()
        where alert_email_deliveries.state <> 'SENT'
          and (alert_email_deliveries.claim_expires_at is null or alert_email_deliveries.claim_expires_at < now())
      returning id
    `);
    return rows.length === 1;
  });
}

async function releaseDigestClaim(
  recipient: DigestRecipient,
  itemIds: readonly string[],
): Promise<void> {
  await withTenantTransaction(recipientContext(recipient), async (transaction) => {
    await transaction.execute(sql`
      update app.alert_email_deliveries
      set state = 'FAILED', claim_expires_at = null, updated_at = now()
      where tenant_id = ${recipient.tenantId}
        and membership_id = ${recipient.membershipId}
        and station_id = ${recipient.stationId}
        and digest_key = ${digestKey(itemIds)}
        and state = 'CLAIMED'
    `);
  });
}

async function recordDigestSent(
  recipient: DigestRecipient,
  itemIds: readonly string[],
  messageId: string,
): Promise<void> {
  await withTenantTransaction(recipientContext(recipient), async (transaction) => {
    await transaction.execute(sql`
      update app.alert_email_deliveries
      set state = 'SENT', provider_message_id = ${messageId}, sent_at = now(),
          claim_expires_at = null, updated_at = now()
      where tenant_id = ${recipient.tenantId}
        and membership_id = ${recipient.membershipId}
        and station_id = ${recipient.stationId}
        and digest_key = ${digestKey(itemIds)}
        and state = 'CLAIMED'
    `);
  });
}

function scheduledActor(identityId: string): AuthenticatedActorContext {
  return {
    identityId,
    session: {
      sessionId: randomUUID(),
      userId: identityId,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  };
}

export type AlertEmailRunDependencies = Readonly<{
  env?: ServerEnv;
  sender?: EmailSender;
  recipients?: readonly DigestRecipient[];
}>;

/** Execute one bounded, fail-per-recipient alert digest run. */
export async function runAlertEmailDigests(
  dependencies: AlertEmailRunDependencies = {},
): Promise<DigestRunResult> {
  const env = dependencies.env ?? getServerEnv();
  // Resend configuration is checked before any recipient is loaded or any
  // database claim is made: an unconfigured deployment cannot partially run.
  const sender = dependencies.sender ?? createResendEmailSender(env);
  const recipients = dependencies.recipients ?? (await loadAlertEmailRecipients());
  const request = new Request(env.APP_URL);

  return runDigests(recipients, {
    loadAlerts: async (recipient) => {
      const facts = await loadActionCenterFacts(
        request,
        { organisationId: recipient.tenantId, stationId: recipient.stationId, allStations: false },
        scheduledActor(recipient.identityId),
      );
      return buildActionCenter(facts);
    },
    lastSentItemIds: readLastSentItemIds,
    claim: claimDigest,
    releaseClaim: releaseDigestClaim,
    recordSent: recordDigestSent,
    send: (message) => sender.send(message),
    appUrl: env.APP_URL,
    onFailure: (recipient, stage, error) => {
      logger.error('Alert digest recipient failed', {
        tenantId: recipient.tenantId,
        stationId: recipient.stationId,
        membershipId: recipient.membershipId,
        stage,
        errorType: error instanceof Error ? error.constructor?.name || 'Error' : typeof error,
      });
    },
  });
}
