'use client';

import { useClerk } from '@clerk/nextjs';
import { useState } from 'react';

export function SignOutButton() {
  const { signOut } = useClerk();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOutFromClerk() {
    setPending(true);
    setError(null);
    try {
      // Go to the sign-in page as soon as the session ends, rather than via the home page.
      await signOut({ redirectUrl: '/login' });
    } catch {
      setError('Sign out failed. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        className="button button-secondary"
        type="button"
        onClick={() => void signOutFromClerk()}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
