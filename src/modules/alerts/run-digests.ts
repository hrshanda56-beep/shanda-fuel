import type { ActionItem } from '../approvals/action-center-model';
import { composeDigest, shouldSendDigest } from './digest';

/**
 * The scheduled run that emails alert digests. It owns the order of steps and the rule that one
 * person's failure never stops the others; everything that touches the database or the email
 * provider is passed in, so the run is tested without either.
 *
 * Each alert list is loaded *as the recipient* (their own permissions and stations), so nobody is
 * emailed something they could not see in the app.
 */

export type DigestRecipient = Readonly<{
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  stationName: string;
  membershipId: string;
  identityId: string;
  email: string;
  name: string | null;
}>;

export type DigestPorts = Readonly<{
  /** The alerts this person would see for this station, using their own access. */
  loadAlerts(
    recipient: DigestRecipient,
  ): Promise<{ items: readonly ActionItem[]; unavailable: readonly string[] }>;
  /** Alert ids in the last email sent to this person for this station. */
  lastSentItemIds(recipient: DigestRecipient): Promise<readonly string[]>;
  recordSent(
    recipient: DigestRecipient,
    itemIds: readonly string[],
    messageId: string,
  ): Promise<void>;
  send(message: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<{ messageId: string }>;
  appUrl: string;
  onFailure?(recipient: DigestRecipient, stage: 'load' | 'send' | 'record', error: unknown): void;
}>;

export type DigestRunResult = Readonly<{
  sent: number;
  skipped: number;
  failed: number;
}>;

export async function runDigests(
  recipients: readonly DigestRecipient[],
  ports: DigestPorts,
): Promise<DigestRunResult> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const recipient of recipients) {
    let stage: 'load' | 'send' | 'record' = 'load';
    try {
      const { items, unavailable } = await ports.loadAlerts(recipient);
      const last = await ports.lastSentItemIds(recipient);
      if (!shouldSendDigest(items, last)) {
        skipped += 1;
        continue;
      }
      const digest = composeDigest({
        recipientName: recipient.name,
        stationName: recipient.stationName,
        items,
        unavailable,
        appUrl: ports.appUrl,
      });
      stage = 'send';
      const receipt = await ports.send({
        to: recipient.email,
        subject: digest.subject,
        text: digest.text,
        html: digest.html,
      });
      sent += 1;
      stage = 'record';
      await ports.recordSent(recipient, digest.itemIds, receipt.messageId);
    } catch (error) {
      // A failed record after a successful send still counts as sent: the email went out.
      if (stage !== 'record') failed += 1;
      ports.onFailure?.(recipient, stage, error);
    }
  }
  return { sent, skipped, failed };
}
