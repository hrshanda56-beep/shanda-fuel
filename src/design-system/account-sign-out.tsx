'use client';

import { useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/platform/auth/client';

/** Chosen on the server (AuthorizedAppShell); the browser never decides it. */
export type AccountAuthProvider = 'BETTER_AUTH' | 'CLERK';

/**
 * The account menu's Sign out. Mirrors the provider-aware Settings button; the
 * Better Auth handler is never used in Clerk mode and the reverse.
 */
export function AccountSignOutItem({ provider }: { provider: AccountAuthProvider }) {
  return provider === 'CLERK' ? <ClerkSignOutItem /> : <BetterAuthSignOutItem />;
}

// `useClerk` runs only inside this component, which is mounted only when the
// server selected Clerk (the root layout mounts ClerkProvider only then).
function ClerkSignOutItem() {
  const { signOut } = useClerk();
  const router = useRouter();
  return (
    <SignOutItem
      run={async () => {
        await signOut();
        router.replace('/login');
        router.refresh();
      }}
    />
  );
}

function BetterAuthSignOutItem() {
  const router = useRouter();
  return (
    <SignOutItem
      run={async () => {
        const result = await authClient.signOut();
        if (result.error) throw new Error('Sign out failed');
        router.replace('/login');
        router.refresh();
      }}
    />
  );
}

/** Shared by both providers: the menu item, its busy state and its error. */
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
        role="menuitem"
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
