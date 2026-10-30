'use client';

import { useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type AccountAuthProvider = 'CLERK';

export function AccountSignOutItem(_props: { provider?: AccountAuthProvider }) {
  const { signOut } = useClerk();
  const router = useRouter();
  return (
    <SignOutItem
      run={async () => {
        // Local dev sign-in keeps its own cookie, which Clerk knows nothing about. The route is
        // a 404 anywhere that sign-in is off, so this falls through to the normal Clerk sign-out.
        const dev = await fetch('/api/dev-login', {
          method: 'POST',
          body: new URLSearchParams({ user: '__signout' }),
          redirect: 'manual',
        }).catch(() => null);
        if (dev && dev.status !== 404) {
          window.location.assign('/dev-login');
          return;
        }
        // Go to the sign-in page as soon as the session ends, rather than via the home page.
        await signOut({ redirectUrl: '/login' });
        router.replace('/login');
        router.refresh();
      }}
    />
  );
}

/** Sign-out busy and error states. */
function SignOutItem({ run }: { run: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function signOut() {
    setPending(true);
    setError(false);
    try {
      await run();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="account-menu-item"
        onClick={() => void signOut()}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error ? (
        <p className="account-menu-error" role="alert">
          Sign out failed. Please try again.
        </p>
      ) : null}
    </>
  );
}
