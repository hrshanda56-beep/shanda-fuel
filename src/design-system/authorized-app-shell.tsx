import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppShell, type AppShellProps } from './app-shell';
import { emptyNavigationProjection } from './navigation-projection';
import { getServerShellAccess, type ServerShellAccess } from './navigation-server';
import { getAuthProviderName } from '@/platform/auth/provider';

import { EntryShell } from './entry/entry-shell';
import { NoWorkplace } from './entry/workplace-views';

export type AuthorizedAppShellProps = Omit<AppShellProps, 'navigationProjection'> & {
  children: ReactNode;
  /** Set only by the attendant workspace itself, the one page they may use. */
  attendantHome?: boolean;
  /** Reuse access already verified by the parent server page in the same request. */
  shellAccess?: ServerShellAccess;
};

/**
 * Server boundary for the shell. The client shell receives only a projection
 * derived from the current authenticated actor and validated scope; it never
 * evaluates raw permissions. Unauthenticated or invalid context renders a
 * deliberately empty projection rather than an all-visible fallback.
 */
export async function AuthorizedAppShell({
  attendantHome = false,
  shellAccess: providedShellAccess,
  ...props
}: AuthorizedAppShellProps) {
  const access = providedShellAccess ?? (await getServerShellAccess(await headers()));
  // Resolve before producing any product UI: no dashboard flash, no client spinner.
  if (access.status === 'signed-out') redirect('/login');
  if (access.status === 'no-workplace') {
    return (
      <EntryShell>
        <NoWorkplace />
      </EntryShell>
    );
  }
  // Someone whose permissions are only shift and meter work never gets a
  // management page, not even an empty one: send them to their own workspace.
  // Every data route still authorises on its own; this is not the security
  // boundary, it is the honest user experience on top of it.
  if (
    !attendantHome &&
    access.projection?.some((entry) => entry.key === 'my-shift' && entry.visible)
  ) {
    redirect('/my-shift');
  }
  return (
    <AppShell
      {...props}
      authProvider={getAuthProviderName()}
      navigationProjection={access.projection ?? emptyNavigationProjection}
    />
  );
}
