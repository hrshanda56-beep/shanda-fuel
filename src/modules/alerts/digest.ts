import { escapeHtml, renderEmail } from '../../platform/email/layout';
import type { ActionItem } from '../approvals/action-center-model';

/**
 * The email a person gets when something needs their attention. Pure: it builds the words and
 * decides whether a message is worth sending; reading data and sending live elsewhere.
 */

const MAX_ITEMS = 15;
/** Where each person switches the emails off. */
export const STOP_PATH = '/settings/alert-email';

/**
 * Email is not a secure channel (ADR-020), so a message names *what kind* of thing needs a look and
 * links to it, never the alert's own title or detail, which carry amounts, customer and supplier
 * names. Fixed wording, matched on the start of the alert id. Longest prefixes first.
 */
const GENERIC_LABELS: readonly (readonly [prefix: string, label: string])[] = [
  ['reconciliation-', 'A daily reconciliation is waiting for approval'],
  ['revaluation-', 'A cost revaluation is waiting for approval'],
  ['reports-late', 'A daily report is late'],
  ['cash-pending-confirmation', 'A bank deposit is waiting to be confirmed'],
  ['cash-unbanked', 'Cash has not been banked'],
  ['cash-short', 'Cash was counted short'],
  ['stock-variance-', 'A tank reading differs from the book stock'],
  ['stock-low-', 'A tank is running low'],
  ['settlement', 'Card or mobile money payments need matching'],
  ['settlements-overdue', 'Card or mobile money payments are overdue'],
  ['suppliers-', 'A supplier invoice needs attention'],
  ['supplier-payment-no-proof', 'A supplier payment has no proof attached'],
  ['customers-', 'A customer account needs attention'],
  ['customer-over-limit', 'A customer account is over its limit'],
  ['customer-overdue', 'A customer account is overdue'],
  ['expense-high-', 'A large expense was recorded'],
  ['sale-below-price', 'A sale was below the approved price'],
  ['delivery-short-', 'A fuel delivery was short'],
  ['approved-information-changed', 'Approved information was changed'],
];

export function genericLabel(item: Pick<ActionItem, 'id' | 'area'>): string {
  const hit = GENERIC_LABELS.find(([prefix]) => item.id.startsWith(prefix));
  return hit ? hit[1] : `Something needs a look in ${item.area}`;
}

export type DigestInput = Readonly<{
  recipientName: string | null;
  stationName: string;
  items: readonly ActionItem[];
  /** Parts that could not be checked, so the email never claims "all clear" it cannot know. */
  unavailable: readonly string[];
  /** The address people sign in at, without a trailing slash. */
  appUrl: string;
}>;

export type Digest = Readonly<{
  subject: string;
  text: string;
  html: string;
  /** The alerts that are in the email, so a later run can tell what is new. */
  itemIds: readonly string[];
}>;

/** Only things that need action are emailed; informational notes stay in the app. */
export function itemsWorthEmailing(items: readonly ActionItem[]): ActionItem[] {
  return items.filter((item) => item.tone === 'attention');
}

/**
 * Send when something needing attention is new since the last email for this person and station.
 * A reminder that was already sent, and has not changed, is not sent again.
 */
export function shouldSendDigest(
  items: readonly ActionItem[],
  lastSentItemIds: readonly string[],
): boolean {
  const already = new Set(lastSentItemIds);
  return itemsWorthEmailing(items).some((item) => !already.has(item.id));
}

function absolute(appUrl: string, href: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return href.startsWith('/') ? `${base}${href}` : `${base}/${href}`;
}

export function composeDigest(input: DigestInput): Digest {
  const worth = itemsWorthEmailing(input.items);
  const shown = worth.slice(0, MAX_ITEMS);
  const more = worth.length - shown.length;
  const count = worth.length;
  const subject =
    count === 1
      ? `1 thing needs your attention at ${input.stationName}`
      : `${count} things need your attention at ${input.stationName}`;
  const greeting = input.recipientName?.trim() ? `Hello ${input.recipientName.trim()},` : 'Hello,';

  const base = input.appUrl.replace(/\/+$/, '');
  const intro = `${input.stationName} has ${count === 1 ? 'something' : 'some things'} that need attention:`;
  const textItems = shown.flatMap((item) => [
    `- ${genericLabel(item)}`,
    `  ${absolute(input.appUrl, item.href)}`,
  ]);
  const htmlItems = shown
    .map(
      (item) =>
        `<li style="margin:0 0 12px;"><strong>${escapeHtml(genericLabel(item))}</strong><br>` +
        `<a href="${escapeHtml(absolute(input.appUrl, item.href))}" style="color:#0a5a4a;">Open</a></li>`,
    )
    .join('');
  const extra = [
    ...(more > 0 ? [`...and ${more} more. Open the app to see everything.`] : []),
    ...(input.unavailable.length > 0
      ? [`Not checked this time: ${input.unavailable.join(', ')}.`]
      : []),
  ];
  const { text, html } = renderEmail({
    logoUrl: `${base}/email-logo.png`,
    heading: 'Needs your attention',
    subheading: input.stationName,
    greeting,
    paragraphs: [intro],
    bodyHtml: `<ul style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:1.6;">${htmlItems}</ul>`,
    bodyText: textItems.join('\n'),
    ...(extra.length > 0 ? { notice: { title: 'Also', body: extra.join(' ') } } : {}),
    button: { label: 'Open Shanda Fuel', url: base },
    footer: 'Sent by Shanda Fuel.',
    footerLinks: [{ label: 'Stop these emails', url: absolute(input.appUrl, STOP_PATH) }],
  });

  return { subject, text, html, itemIds: worth.map((item) => item.id) };
}
