'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/platform/auth/client';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError('Signing out didn’t work. Try again.');
        return;
      }
      router.replace('/login');
      router.refresh();
    } catch {
      setError('Signing out didn’t work. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        className="button button-secondary button-sign-out"
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
