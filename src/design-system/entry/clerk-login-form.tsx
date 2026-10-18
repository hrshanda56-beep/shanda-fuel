'use client';

import { useSignIn } from '@clerk/nextjs/legacy';
import { SignIn } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';

import { Button, Field } from '../primitives';
import { PasswordField } from './password-field';
import { safePostSignInPath } from './entry-logic';

export function ClerkLoginForm({ next, invited = false }: { next?: string; invited?: boolean }) {
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [verificationRequired, setVerificationRequired] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded) return;
    setError(undefined);
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const identifier = String(form.get('identifier') ?? '').trim();
    const password = String(form.get('password') ?? '');
    try {
      const result = await signIn.create({ identifier, password });
      if (result.status !== 'complete' || !result.createdSessionId) {
        setVerificationRequired(true);
        return;
      }
      await setActive({ session: result.createdSessionId });
      router.push(safePostSignInPath(next));
      router.refresh();
    } catch {
      setError('The sign-in details were not accepted. Check them and try again.');
      if (passwordRef.current) {
        passwordRef.current.value = '';
        passwordRef.current.focus();
      }
    } finally {
      setLoading(false);
    }
  }

  // Clerk completes MFA, password resets and other provider challenges before
  // redirecting back to the invitation or authorized workplace selection.
  if (verificationRequired) {
    return <SignIn routing="hash" forceRedirectUrl={safePostSignInPath(next)} />;
  }

  return (
    <section aria-labelledby="entry-title">
      <header className="entry-heading">
        <h1 id="entry-title">{invited ? 'Sign in to join your workspace' : 'Welcome back'}</h1>
        <p>Sign in with your work email or Staff Number.</p>
      </header>
      <form className="entry-form" aria-labelledby="entry-title" onSubmit={submit}>
        <Field id="identifier" label="Email or Staff Number" required>
          <input
            id="identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </Field>
        <Field id="password" label="Password" required>
          <PasswordField
            id="password"
            name="password"
            autoComplete="current-password"
            ref={passwordRef}
          />
        </Field>
        {error ? (
          <p className="entry-alert" role="alert">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          loading={loading}
          disabled={!isLoaded}
        >
          Sign in
        </Button>
      </form>
      <button type="button" className="entry-link" onClick={() => setVerificationRequired(true)}>
        Forgot your password?
      </button>
      <p className="entry-footnote">
        <Link className="entry-link" href="/join">
          First time? Activate your account
        </Link>
      </p>
    </section>
  );
}
