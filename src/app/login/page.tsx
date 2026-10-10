import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { EntryShell } from '@/design-system/entry/entry-shell';
import { LoginForm } from '@/design-system/entry/login-form';
import { ClerkLoginForm } from '@/design-system/entry/clerk-login-form';
import { hasActiveSession } from '@/design-system/entry/session';
import { getAuthProviderName } from '@/platform/auth/provider';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Someone who is already signed in never sees the form flash before leaving.
  if (await hasActiveSession(await headers())) redirect('/workplace');

  return (
    <EntryShell>
      {getAuthProviderName() === 'CLERK' ? (
        <ClerkLoginForm next={next} />
      ) : (
        <LoginForm next={next} />
      )}
    </EntryShell>
  );
}
