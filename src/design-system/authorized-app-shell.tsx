import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppShell, type AppShellProps } from './app-shell';
import { emptyNavigationProjection } from './navigation-projection';
import { getServerShellAccess } from './navigation-server';
import { EntryShell } from './entry/entry-shell';
import { NoWorkplace } from './entry/workplace-views';

export type AuthorizedAppShellProps = Omit<AppShellProps, 'navigationProjection'> & {
  children: ReactNode;
};

/**
 * Server boundary for the shell. The client shell receives only a projection
 * derived from the current authenticated actor and validated scope; it never
 * evaluates raw permissions. Unauthenticated or invalid context renders a
 * deliberately empty projection rather than an all-visible fallback.
 */
export async function AuthorizedAppShell(props: AuthorizedAppShellProps) {
  const access = await getServerShellAccess(await headers());
  // Resolve before producing any product UI: no dashboard flash, no client spinner.
  if (access.status === 'signed-out') redirect('/login');
  if (access.status === 'no-workplace') {
    return (
      <EntryShell>
        <NoWorkplace />
      </EntryShell>
    );
  }
  return (
    <AppShell {...props} navigationProjection={access.projection ?? emptyNavigationProjection} />
  );
}
