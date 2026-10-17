'use client';

import { useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SignOutButton(_props: { provider?: 'CLERK' }) {
  const { signOut } = useClerk();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOutFromClerk() {
    setPending(true);
    setError(null);
    try {
      await signOut();
      router.replace('/login');
      router.refresh();
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
