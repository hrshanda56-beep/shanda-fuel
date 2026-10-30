import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { EntryShell } from '@/design-system/entry/entry-shell';
import { ClerkLoginForm } from '@/design-system/entry/clerk-login-form';
import { isLocalDevBypassEnabled } from '@/platform/auth/dev-bypass';
import { hasActiveSession } from '@/design-system/entry/session';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if (isLocalDevBypassEnabled() && !(await hasActiveSession(await headers())))
    redirect('/dev-login');
  // Someone who is already signed in never sees the form flash before leaving.
  if (await hasActiveSession(await headers())) redirect('/workplace');

  return (
    <EntryShell>
      <ClerkLoginForm next={next} />
    </EntryShell>
  );
}
