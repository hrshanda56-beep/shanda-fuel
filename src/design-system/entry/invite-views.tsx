'use client';

import { useRef, useState, type FormEvent } from 'react';

import { Button, Field } from '../primitives';

import { PASSWORD_REQUIREMENTS, validateNewPassword, type NewPasswordIssues } from './entry-logic';
import { PasswordField } from './password-field';

/** Expired, revoked, used and invalid links all land here, with the same words. */
export function InviteUnavailable() {
  return (
    <section aria-labelledby="entry-title">
      <header className="entry-heading">
        <h1 id="entry-title">This invitation is no longer available</h1>
        <p>Ask your manager to send a new invitation.</p>
      </header>
      <p className="entry-secondary">
        <a href="/login">Already have an account? Sign in</a>
      </p>
    </section>
  );
}

export type AcceptInvitation = (password: string) => Promise<{ ok: true } | { ok: false }>;

/** New identity: the invited email is shown but cannot be edited. */
export function JoinWorkspaceForm({
  organisationName,
  email,
  accept,
}: {
  organisationName: string;
  email: string;
  accept: AcceptInvitation;
}) {
  const passwordRef = useRef<HTMLInputElement>(null);
  const [issues, setIssues] = useState<NewPasswordIssues>({});
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');
    const found = validateNewPassword(password, confirm);
    setIssues(found);
    if (found.password || found.confirm) {
      passwordRef.current?.focus();
      return;
    }
    setLoading(true);
    try {
      const result = await accept(password);
      if (!result.ok) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="entry-title">
      <header className="entry-heading">
        <h1 id="entry-title">You&apos;re joining Shanda Fuel</h1>
        <p>
          You&apos;ve been invited to join{' '}
          <strong className="entry-wrap">{organisationName}</strong>.
        </p>
      </header>

      <form className="entry-form" aria-labelledby="entry-title" onSubmit={handleSubmit} noValidate>
        <Field id="invite-email" label="Invited email">
          <input
            id="invite-email"
            name="email"
            type="email"
            value={email}
            readOnly
            autoComplete="username"
            aria-describedby="invite-email-note"
          />
        </Field>
        <p className="entry-note" id="invite-email-note">
          This is the account you were invited with.
        </p>

        <Field
          id="invite-password"
          label="Create password"
          hint={PASSWORD_REQUIREMENTS.join('. ')}
          error={issues.password}
          required
        >
          <PasswordField
            id="invite-password"
            name="password"
            autoComplete="new-password"
            ref={passwordRef}
          />
        </Field>

        <Field id="invite-confirm" label="Confirm password" error={issues.confirm} required>
          <PasswordField id="invite-confirm" name="confirm" autoComplete="new-password" />
        </Field>

        {failed ? (
          <p className="entry-alert" role="alert">
            We couldn&apos;t complete that. Try again, or ask your manager for a new invitation.
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" block loading={loading}>
          Join workspace
        </Button>
      </form>
    </section>
  );
}
