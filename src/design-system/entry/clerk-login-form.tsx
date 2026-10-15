'use client';

import { useSignIn } from '@clerk/nextjs/legacy';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Button, Field } from '../primitives';
import { PasswordField } from './password-field';
import { safePostSignInPath } from './entry-logic';

export function ClerkLoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

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
        setError('Additional verification is required to continue.');
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

  return (
    <section aria-labelledby="entry-title">
      <header className="entry-heading">
        <h1 id="entry-title">Welcome back</h1>
        <p>Sign in with your work email or Staff number.</p>
      </header>
      <form className="entry-form" aria-labelledby="entry-title" onSubmit={submit}>
        <Field id="identifier" label="Email or Staff number" required>
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
      <p className="entry-footnote">New here? Use the invitation from your manager.</p>
    </section>
  );
}
