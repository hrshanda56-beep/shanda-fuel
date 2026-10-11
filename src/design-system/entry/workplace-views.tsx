'use client';

import { useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/platform/auth/client';
import { Button } from '../primitives';

import type { WorkplaceOption } from './entry-logic';

type AuthProviderName = 'BETTER_AUTH' | 'CLERK';

/** Several accessible stations: one tap on a whole row picks it. */
export function WorkplacePicker({ options }: { options: readonly WorkplaceOption[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string>();
  const [failed, setFailed] = useState(false);

  async function choose(option: WorkplaceOption) {
    if (pendingId) return;
    setFailed(false);
    setPendingId(option.stationId);
    try {
      const response = await fetch('/api/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pathname: '/',
          selection: {
            organisationId: option.organisationId,
            legalEntityId: option.legalEntityId,
            stationId: option.stationId,
            allStations: false,
          },
        }),
      });
      if (!response.ok) throw new Error('context');
      router.push('/');
    } catch {
      setFailed(true);
      setPendingId(undefined);
    }
  }

  return (
    <section aria-labelledby="entry-title">
      <header className="entry-heading">
        <h1 id="entry-title">Where are you working today?</h1>
      </header>
      <ul className="entry-choices">
        {options.map((option) => (
          <li key={option.stationId}>
            <button
              type="button"
              className="entry-choice"
              disabled={pendingId !== undefined}
              aria-busy={pendingId === option.stationId || undefined}
              onClick={() => void choose(option)}
            >
              <span className="entry-choice-name">{option.stationName}</span>
              {option.detail ? <span className="entry-choice-detail">{option.detail}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {failed ? (
        <p className="entry-alert" role="alert">
          We couldn&apos;t open that station. Please try again.
        </p>
      ) : null}
    </section>
  );
}

/** Signed in, but no active membership grants a workplace. */
export function NoWorkplace({ provider = 'BETTER_AUTH' }: { provider?: AuthProviderName }) {
  return provider === 'CLERK' ? <ClerkNoWorkplace /> : <BetterAuthNoWorkplace />;
}

function BetterAuthNoWorkplace() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    try {
      await authClient.signOut();
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <section aria-labelledby="entry-title">
      <header className="entry-heading">
        <h1 id="entry-title">You don&apos;t have a workplace yet</h1>
        <p>
          Your account is signed in, but it isn&apos;t linked to a station. Ask your manager to
          check your access.
        </p>
      </header>
      <div className="entry-form">
        <Button
          variant="secondary"
          size="lg"
          block
          loading={loading}
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
      </div>
    </section>
  );
}

function ClerkNoWorkplace() {
  const { signOut } = useClerk();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOutFromClerk() {
    setLoading(true);
    try {
      await signOut();
    } finally {
      router.push('/login');
      router.refresh();
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="entry-title">
      <header className="entry-heading">
        <h1 id="entry-title">You don&apos;t have a workplace yet</h1>
        <p>
          Your account is signed in, but it isn&apos;t linked to a station. Ask your manager to
          check your access.
        </p>
      </header>
      <div className="entry-form">
        <Button
          variant="secondary"
          size="lg"
          block
          loading={loading}
          onClick={() => void signOutFromClerk()}
        >
          Sign out
        </Button>
      </div>
    </section>
  );
}
