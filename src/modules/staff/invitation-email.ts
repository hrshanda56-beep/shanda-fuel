import { renderEmail } from '../../platform/email/layout';

export function buildInvitationEmail(input: {
  name: string;
  organisationName: string;
  url: string;
  /** Absolute address of the logo image; mail apps cannot load relative paths. */
  logoUrl: string;
}): { subject: string; text: string; html: string } {
  const { text, html } = renderEmail({
    logoUrl: input.logoUrl,
    heading: 'Set up your account',
    subheading: `You have been invited to ${input.organisationName}`,
    greeting: `Hello ${input.name},`,
    paragraphs: [
      `You have been invited to join ${input.organisationName} on Shanda Fuel. Select the button below to set up your account.`,
    ],
    button: { label: 'Set up my account', url: input.url },
    showLinkFallback: true,
    notice: {
      title: 'Security notice',
      body: 'This link expires after 72 hours. If you were not expecting this invitation, you can ignore this email. Please do not share this email with anyone.',
    },
    footer: `Sent by Shanda Fuel for ${input.organisationName}.`,
  });
  return { subject: `You're invited to ${input.organisationName} on Shanda Fuel`, text, html };
}
