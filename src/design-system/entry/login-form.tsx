'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { authClient } from '@/platform/auth/client';
import { Button, Field } from '../primitives';

import {
  ENTRY_MESSAGES,
  PASSWORD_RESET_AVAILABLE,
  classifyLoginFailure,
  loginFailureMessage,
  safePostSignInPath,
} from './entry-logic';
import { PasswordField } from './password-field';

type PasswordSignInData = {
  twoFactorRedirect?: boolean;
  twoFactorMethods?: string[];
};

/** `invited` shows the existing-account invitation variant of the same form. */
export function LoginForm({ next, invited = false }: { next?: string; invited?: boolean }) {
  const router = useRouter();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const destination = safePostSignInPath(next);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');

    try {
      const result = await authClient.signIn.email({ email, password });

      if (result.error) {
        setError(loginFailureMessage(classifyLoginFailure(result.error)));
        if (passwordRef.current) {
          passwordRef.current.value = '';
          passwordRef.current.focus();
        }
        return;
      }

      const signInData = result.data as PasswordSignInData | null | undefined;
      if (signInData?.twoFactorRedirect === true) {
        if (!signInData.twoFactorMethods?.includes('totp')) {
          setError(ENTRY_MESSAGES.unsupportedSecondFactor);
          return;
        }
        setTwoFactorRequired(true);
        return;
      }

      router.push(destination);
    } catch {
      setError(ENTRY_MESSAGES.unavailable);
    } finally {
      setLoading(false);
    }
  }

  async function handleTotpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (!/^\d{6}$/.test(totpCode)) {
      setError(ENTRY_MESSAGES.codeFormat);
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: totpCode });
      if (result.error) {
        setError(ENTRY_MESSAGES.invalidCode);
        return;
      }
      router.push(destination);
    } catch {
      setError(ENTRY_MESSAGES.invalidCode);
    } finally {
      setLoading(false);
    }
  }

  if (twoFactorRequired) {
    return (
      <section aria-labelledby="entry-title" key="totp-step">
        <header className="entry-heading">
          <h1 id="entry-title">Verify your authenticator</h1>
          <p>Enter the current six-digit code from your authenticator app.</p>
        </header>
        <form
          className="entry-form"
          aria-label="Authenticator verification"
          onSubmit={handleTotpSubmit}
          noValidate
        >
          <Field id="totp-code" label="Authenticator code" required>
            <input
              id="totp-code"
              name="totpCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))}
              autoFocus
            />
          </Field>
          {error ? (
            <p className="entry-alert" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" size="lg" block loading={loading}>
            Verify code
          </Button>
        </form>
      </section>
    );
  }

  return (
    <section aria-labelledby="entry-title" key="password-step">
      <header className="entry-heading">
        {invited ? (
          <>
            <h1 id="entry-title">You&apos;ve been invited to another workspace</h1>
            <p>Sign in with your existing account to join it.</p>
          </>
        ) : (
          <>
            <h1 id="entry-title">Welcome back</h1>
            <p>Sign in to continue to Shanda Fuel</p>
          </>
        )}
      </header>

      <form className="entry-form" aria-labelledby="entry-title" onSubmit={handlePasswordSubmit}>
        <Field id="email" label="Work email" required>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
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

        <Button type="submit" variant="primary" size="lg" block loading={loading}>
          {invited ? 'Sign in to join' : 'Sign in'}
        </Button>

        {PASSWORD_RESET_AVAILABLE ? (
          <p className="entry-secondary">
            <a href="/forgot-password">Forgot password?</a>
          </p>
        ) : null}
      </form>

      {invited ? null : (
        <p className="entry-footnote">New here? Use the invitation sent by your manager.</p>
      )}
    </section>
  );
}
