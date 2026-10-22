import type { ActionItem } from '../approvals/action-center-model';

/**
 * The email a person gets when something needs their attention. Pure: it builds the words and
 * decides whether a message is worth sending; reading data and sending live elsewhere.
 */

const MAX_ITEMS = 15;

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

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

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

  const textLines = [
    greeting,
    '',
    `${input.stationName} has ${count === 1 ? 'something' : 'some things'} that need attention:`,
    '',
    ...shown.flatMap((item) => [
      `- ${item.title}`,
      `  ${item.detail}`,
      `  ${absolute(input.appUrl, item.href)}`,
    ]),
    ...(more > 0 ? ['', `...and ${more} more. Open the app to see everything.`] : []),
    ...(input.unavailable.length > 0
      ? ['', `Not checked this time: ${input.unavailable.join(', ')}.`]
      : []),
    '',
    `Open Shanda Fuel: ${input.appUrl.replace(/\/+$/, '')}`,
  ];

  const htmlItems = shown
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.title)}</strong><br>${escapeHtml(item.detail)}<br>` +
        `<a href="${escapeHtml(absolute(input.appUrl, item.href))}">Open</a></li>`,
    )
    .join('');
  const html =
    `<p>${escapeHtml(greeting)}</p>` +
    `<p>${escapeHtml(input.stationName)} has ${count === 1 ? 'something' : 'some things'} that need attention:</p>` +
    `<ul>${htmlItems}</ul>` +
    (more > 0 ? `<p>…and ${more} more. Open the app to see everything.</p>` : '') +
    (input.unavailable.length > 0
      ? `<p>Not checked this time: ${escapeHtml(input.unavailable.join(', '))}.</p>`
      : '') +
    `<p><a href="${escapeHtml(input.appUrl.replace(/\/+$/, ''))}">Open Shanda Fuel</a></p>`;

  return { subject, text: textLines.join('\n'), html, itemIds: worth.map((item) => item.id) };
}
