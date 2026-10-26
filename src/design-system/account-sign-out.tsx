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
