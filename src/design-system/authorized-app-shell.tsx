import 'server-only';

import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { AppShell, type AppShellProps } from './app-shell';
import { emptyNavigationProjection } from './navigation-projection';
import { getServerNavigationProjection } from './navigation-server';

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
  const projection = await getServerNavigationProjection(await headers());
  return <AppShell {...props} navigationProjection={projection ?? emptyNavigationProjection} />;
}
