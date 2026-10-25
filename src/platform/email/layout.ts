/**
 * The one look for every email Shanda Fuel sends: logo, heading, body, a button, a notice box and a
 * footer on a white card. Pure so it can be tested without sending anything.
 * Uses table layout and inline styles because mail apps ignore most modern CSS.
 */

const BRAND_DARK = '#0a5a4a';
const INK = '#1c2b27';
const MUTED = '#52625d';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type EmailContent = Readonly<{
  /** Absolute address of the logo; mail apps cannot load relative paths. */
  logoUrl: string;
  heading: string;
  /** One quiet line under the heading. */
  subheading?: string;
  greeting?: string;
  /** Plain paragraphs; escaped here. */
  paragraphs?: readonly string[];
  /** Ready-made HTML for the body when paragraphs are not enough. Callers must escape it. */
  bodyHtml?: string;
  /** Plain-text version of bodyHtml. */
  bodyText?: string;
  button?: Readonly<{ label: string; url: string }>;
  /** Show the address under the button for people whose mail app hides links. */
  showLinkFallback?: boolean;
  notice?: Readonly<{ title: string; body: string }>;
  footer: string;
  /** Extra links shown in the footer, such as "Stop these emails". */
  footerLinks?: readonly Readonly<{ label: string; url: string }>[];
}>;

export function renderEmail(content: EmailContent): { text: string; html: string } {
  const text = [
    ...(content.greeting ? [content.greeting, ''] : [content.heading, '']),
    ...(content.paragraphs ?? []).flatMap((paragraph) => [paragraph, '']),
    ...(content.bodyText ? [content.bodyText, ''] : []),
    ...(content.button ? [`${content.button.label}: ${content.button.url}`, ''] : []),
    ...(content.notice ? [`${content.notice.title}: ${content.notice.body}`, ''] : []),
    content.footer,
    ...(content.footerLinks ?? []).map((link) => `${link.label}: ${link.url}`),
  ].join('\n');

  const paragraphs = (content.paragraphs ?? [])
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};">${escapeHtml(paragraph)}</p>`,
    )
    .join('');
  const button = content.button
    ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:8px auto 20px;"><tr>
<td style="background:${BRAND_DARK};border-radius:8px;"><a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">${escapeHtml(content.button.label)}</a></td>
</tr></table>`
    : '';
  const fallback =
    content.button && content.showLinkFallback
      ? `<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:${MUTED};text-align:center;">Or copy and paste this link into your browser:<br><a href="${escapeHtml(content.button.url)}" style="color:${INK};word-break:break-all;">${escapeHtml(content.button.url)}</a></p>`
      : '';
  const notice = content.notice
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;"><tr>
<td style="background:#f3f6f5;border-radius:8px;padding:16px 20px;font-size:14px;line-height:1.5;color:${MUTED};"><strong style="display:block;margin:0 0 4px;color:${INK};">${escapeHtml(content.notice.title)}</strong>${escapeHtml(content.notice.body)}</td>
</tr></table>`
    : '';
  const footerLinks = (content.footerLinks ?? [])
    .map(
      (link) =>
        `<br><a href="${escapeHtml(link.url)}" style="color:${MUTED};">${escapeHtml(link.label)}</a>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#e9eeec;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9eeec;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;font-family:${FONT};color:${INK};">
<tr><td align="center" style="padding:36px 32px 0;">
<img src="${escapeHtml(content.logoUrl)}" width="56" height="56" alt="Shanda Fuel" style="display:block;border:0;border-radius:12px;">
<h1 style="margin:20px 0 6px;font-size:24px;line-height:1.3;font-weight:700;color:${INK};">${escapeHtml(content.heading)}</h1>
${content.subheading ? `<p style="margin:0;font-size:15px;line-height:1.5;color:${MUTED};">${escapeHtml(content.subheading)}</p>` : ''}
</td></tr>
<tr><td style="padding:28px 40px 8px;">
${content.greeting ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};">${escapeHtml(content.greeting)}</p>` : ''}${paragraphs}${content.bodyHtml ?? ''}${button}${fallback}${notice}
</td></tr>
<tr><td style="padding:16px 40px 32px;"><hr style="border:0;border-top:1px solid #e3e9e6;margin:0 0 16px;"><p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};text-align:center;">${escapeHtml(content.footer)}${footerLinks}</p></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { text, html };
}
