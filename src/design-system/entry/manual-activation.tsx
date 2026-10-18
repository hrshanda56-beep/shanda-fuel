'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSignIn } from '@clerk/nextjs/legacy';
import { SignIn } from '@clerk/nextjs';
import { useRef, useState, type FormEvent } from 'react';

import { Button, Field } from '../primitives';
import { PASSWORD_REQUIREMENTS, validateNewPassword, type NewPasswordIssues } from './entry-logic';
import { PasswordField } from './password-field';

export function ManualActivationForm() {
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [activated, setActivated] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [issues, setIssues] = useState<NewPasswordIssues>({});
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirm = String(form.get('confirm') ?? '');
    const nextIssues = validateNewPassword(password, confirm);
    setIssues(nextIssues);
    if (nextIssues.password || nextIssues.confirm) {
      passwordRef.current?.focus();
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/staff/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          commandType: 'ActivateManualStaff',
          staffNumber: String(form.get('staffNumber') ?? ''),
          activationCode: String(form.get('activationCode') ?? ''),
          password,
        }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(
          response.status === 429
            ? 'Too many activation attempts. Please wait 15 minutes before trying again.'
            : response.status >= 500
              ? 'Account setup could not be completed. Ask your manager to check the employee name and authentication settings. This is not an incorrect-code attempt.'
              : (response.status === 400 || response.status === 422) && failure?.message
                ? failure.message
                : 'Check your Staff Number and code. After 5 incorrect codes, you must ask your manager for a new code.',
        );
        return;
      }
      setActivated(true);
      try {
        if (!isLoaded || !signIn) throw new Error('Sign-in unavailable');
        const result = await signIn.create({
          identifier: String(form.get('staffNumber') ?? '')
            .trim()
            .toUpperCase(),
          password,
        });
        if (result.status !== 'complete' || !result.createdSessionId) {
          setVerificationRequired(true);
          return;
        }
        await setActive({ session: result.createdSessionId });
        router.replace('/workplace');
        router.refresh();
      } catch {
        setError(
          'Your account was created. Automatic sign-in could not finish. Sign in to continue; do not activate again.',
        );
      }
    } catch {
      setError('We could not complete activation. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  if (verificationRequired) return <SignIn routing="hash" forceRedirectUrl="/workplace" />;
  if (activated)
    return (
      <section aria-labelledby="entry-title">
        <h1 id="entry-title">Your account is ready</h1>
        <p role="status">{error ?? 'Signing you in…'}</p>
        {error ? (
          <Link className="entry-link" href="/login">
            Sign in to continue
          </Link>
        ) : null}
      </section>
    );

  return (
    <section aria-labelledby="entry-title">
      <header className="entry-heading">
        <h1 id="entry-title">Activate your Shanda Fuel account</h1>
        <p>
          Enter the Staff Number and activation code provided by your manager. After 5 incorrect
          codes, your manager must issue a new one.
        </p>
      </header>
      <form className="entry-form" onSubmit={submit} noValidate>
        <Field id="staff-number" label="Staff Number" required>
          <input id="staff-number" name="staffNumber" autoComplete="username" required />
        </Field>
        <Field id="activation-code" label="Activation Code" required>
          <input
            id="activation-code"
            name="activationCode"
            autoComplete="one-time-code"
            placeholder="7K3M-9R2X"
            autoCapitalize="characters"
            spellCheck={false}
            required
          />
        </Field>
        <Field
          id="activation-password"
          label="Create password"
          hint={PASSWORD_REQUIREMENTS.join('. ')}
          error={issues.password}
          required
        >
          <PasswordField
            id="activation-password"
            name="password"
            autoComplete="new-password"
            ref={passwordRef}
          />
        </Field>
        <Field id="activation-confirm" label="Confirm password" error={issues.confirm} required>
          <PasswordField id="activation-confirm" name="confirm" autoComplete="new-password" />
        </Field>
        {error ? (
          <p className="entry-alert" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" block loading={loading}>
          Activate account
        </Button>
      </form>
      <p className="entry-footnote">
        <Link className="entry-link" href="/login">
          Already activated? Sign in
        </Link>
      </p>
    </section>
  );
}
