import type { Metadata } from 'next';

import { EntryShell } from '@/design-system/entry/entry-shell';
import { resolveInvitationView } from '@/design-system/entry/invitation';
import { InviteUnavailable } from '@/design-system/entry/invite-views';
import { ExistingInviteFlow, NewInviteFlow } from '@/design-system/entry/invite-acceptance';
import { ClerkLoginForm } from '@/design-system/entry/clerk-login-form';
import { hasActiveSession } from '@/design-system/entry/session';
import { headers } from 'next/headers';

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

  const requestHeaders = await headers();
  const session =
    view.kind === 'existing-identity' || view.kind === 'new-identity'
      ? await hasActiveSession(requestHeaders)
      : false;

  return (
    <EntryShell>
      {view.kind === 'existing-identity' || (view.kind === 'new-identity' && session) ? (
        session ? (
          <ExistingInviteFlow token={token} />
        ) : (
          <ClerkLoginForm invited next={`/invite/${token}`} />
        )
      ) : view.kind === 'new-identity' ? (
        <NewInviteFlow token={token} organisationName={view.organisationName} email={view.email} />
      ) : (
        <InviteUnavailable />
      )}
    </EntryShell>
  );
}
