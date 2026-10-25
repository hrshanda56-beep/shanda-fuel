/**
 * The staff invitation email. Pure so it can be tested without sending anything.
 * Uses table layout and inline styles because mail apps ignore most modern CSS.
 */

const BRAND_DARK = '#0a5a4a';
const BRAND = '#4aa78b';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildInvitationEmail(input: {
  name: string;
  organisationName: string;
  url: string;
  /** Absolute address of the logo image; mail apps cannot load relative paths. */
  logoUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = `You're invited to ${input.organisationName} on Shanda Fuel`;
  const text = [
    `Hello ${input.name},`,
    '',
    `You have been invited to join ${input.organisationName} on Shanda Fuel.`,
    '',
    `Open this link to set up your account: ${input.url}`,
    '',
    'This link expires after 72 hours. If you were not expecting this invitation, you can ignore this email.',
    '',
    'Shanda Fuel',
  ].join('\n');

  const name = escapeHtml(input.name);
  const organisation = escapeHtml(input.organisationName);
  const url = escapeHtml(input.url);
  const logoUrl = escapeHtml(input.logoUrl);
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f3f6f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c2b27;">
<tr><td style="background:${BRAND_DARK};padding:20px 28px;border-bottom:4px solid ${BRAND};">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px;"><img src="${logoUrl}" width="40" height="40" alt="" style="display:block;border:0;border-radius:9px;"></td>
<td style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.2px;">Shanda Fuel</td>
</tr></table>
</td></tr>
<tr><td style="padding:28px;">
<p style="margin:0 0 16px;font-size:18px;font-weight:600;">Hello ${name},</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5;">You have been invited to join <strong>${organisation}</strong> on Shanda Fuel.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
<td style="background:${BRAND_DARK};border-radius:8px;"><a href="${url}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">Set up my account</a></td>
</tr></table>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#52625d;">This link expires after 72 hours. If you were not expecting this invitation, you can ignore this email.</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#52625d;">Button not working? Copy this link into your browser:<br><a href="${url}" style="color:${BRAND_DARK};word-break:break-all;">${url}</a></p>
</td></tr>
<tr><td style="padding:16px 28px;background:#f3f6f5;font-size:12px;color:#52625d;">Sent by Shanda Fuel for ${organisation}.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { subject, text, html };
}
