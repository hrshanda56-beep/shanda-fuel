import type { Metadata } from 'next';

import { EntryShell } from '@/design-system/entry/entry-shell';
import { resolveInvitationView } from '@/design-system/entry/invitation';
import { InviteUnavailable } from '@/design-system/entry/invite-views';
import { LoginForm } from '@/design-system/entry/login-form';

// The link carries a secret. Keep it out of referrers, caches and search indexes.
export const metadata: Metadata = {
  title: 'Invitation',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await resolveInvitationView(token);

  return (
    <EntryShell>
      {view.kind === 'existing-identity' ? (
        <LoginForm invited next={`/invite/${token}`} />
      ) : (
        // `new-identity` needs the invitation service's accept command; until it
        // exists, resolveInvitationView only ever returns `unavailable`.
        <InviteUnavailable />
      )}
    </EntryShell>
  );
}
