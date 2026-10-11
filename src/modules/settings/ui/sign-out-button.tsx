'use client';

import { useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/platform/auth/client';

type AuthProviderName = 'BETTER_AUTH' | 'CLERK';

export function SignOutButton({ provider = 'BETTER_AUTH' }: { provider?: AuthProviderName }) {
  return provider === 'CLERK' ? <ClerkSignOutButton /> : <BetterAuthSignOutButton />;
}

function BetterAuthSignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError('Sign out failed. Please try again.');
        return;
      }
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
        onClick={signOut}
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

function ClerkSignOutButton() {
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
