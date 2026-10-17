'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '../primitives';
import { JoinWorkspaceForm } from './invite-views';
import { ClerkLoginForm } from './clerk-login-form';

async function postJson(path: string, body: unknown): Promise<boolean> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return response.ok;
}

export function NewInviteFlow({
  token,
  organisationName,
  email,
}: {
  token: string;
  organisationName: string;
  email: string;
}) {
  const [created, setCreated] = useState(false);

  if (created) return <ClerkLoginForm next={`/invite/${token}`} invited />;

  return (
    <JoinWorkspaceForm
      organisationName={organisationName}
      email={email}
      accept={async (password) => {
        if (
          !(await postJson(`/api/invite/${encodeURIComponent(token)}/signup`, { token, password }))
        ) {
          return { ok: false };
        }
        // The server creates the invited Clerk identity. Authenticate it before
        // returning to this invitation for the server-authorized acceptance.
        setCreated(true);
        return { ok: true };
      }}
    />
  );
}

export function ExistingInviteFlow({ token }: { token: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  async function accept() {
    setFailed(false);
    setLoading(true);
    try {
      if (!(await postJson(`/api/invite/${encodeURIComponent(token)}/accept`, { token }))) {
        setFailed(true);
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="entry-title">
      <header className="entry-heading">
        <h1 id="entry-title">Join your new workspace</h1>
        <p>Your account is ready to join this organisation.</p>
      </header>
      {failed ? (
        <p className="entry-alert" role="alert">
          We couldn&apos;t complete that. Try again, or ask your manager for a new invitation.
        </p>
      ) : null}
      <Button type="button" variant="primary" size="lg" block loading={loading} onClick={accept}>
        Accept invitation
      </Button>
    </section>
  );
}
