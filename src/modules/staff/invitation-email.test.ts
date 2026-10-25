import { describe, expect, it } from 'vitest';
import { buildInvitationEmail } from './invitation-email';

describe('buildInvitationEmail', () => {
  const email = buildInvitationEmail({
    name: 'Tendai <b>',
    organisationName: 'TEI Oils',
    url: 'https://fuel.shandahr.com/invite/abc',
    logoUrl: 'https://fuel.shandahr.com/email-logo.png',
  });

  it('is branded and carries the link in both parts', () => {
    expect(email.html).toContain('Shanda Fuel');
    expect(email.html).toContain('href="https://fuel.shandahr.com/invite/abc"');
    expect(email.text).toContain('https://fuel.shandahr.com/invite/abc');
    expect(email.html).toContain('src="https://fuel.shandahr.com/email-logo.png"');
    expect(email.text).toContain('72 hours');
  });

  it('escapes names so they cannot inject markup', () => {
    expect(email.html).not.toContain('<b>');
    expect(email.html).toContain('Tendai &lt;b&gt;');
  });
});
