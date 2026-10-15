'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Button, Field } from '../primitives';
import { PASSWORD_REQUIREMENTS, validateNewPassword, type NewPasswordIssues } from './entry-logic';
import { PasswordField } from './password-field';

export function ManualActivationForm() {
  const router = useRouter();
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
        setError(
          'This activation is unavailable. Check the details or ask your manager for a new code.',
        );
        return;
      }
      router.push('/login?activated=1');
      router.refresh();
    } catch {
      setError('We could not complete activation. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="entry-title">
      <header className="entry-heading">
        <h1 id="entry-title">Activate your Shanda Fuel account</h1>
        <p>Enter the Staff number and activation code provided by your manager.</p>
      </header>
      <form className="entry-form" onSubmit={submit} noValidate>
        <Field id="staff-number" label="Staff number" required>
          <input id="staff-number" name="staffNumber" autoComplete="username" required />
        </Field>
        <Field id="activation-code" label="Activation code" required>
          <input id="activation-code" name="activationCode" autoComplete="one-time-code" required />
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
    </section>
  );
}
