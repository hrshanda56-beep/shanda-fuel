'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authClient } from '@/platform/auth/client';

import { Button } from '../primitives';
import { JoinWorkspaceForm } from './invite-views';

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
  const router = useRouter();

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
        const signIn = await authClient.signIn.email({ email, password });
        if (signIn.error) return { ok: false };
        if (!(await postJson(`/api/invite/${encodeURIComponent(token)}/accept`, { token }))) {
          return { ok: false };
        }
        router.push('/');
        router.refresh();
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
