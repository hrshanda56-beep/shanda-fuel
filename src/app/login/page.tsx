'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/platform/auth/client';
import { BrandMark } from '@/design-system/brand-mark';
import { Button, Card, Field } from '@/design-system/primitives';

type PasswordSignInData = {
  twoFactorRedirect?: boolean;
  twoFactorMethods?: string[];
};

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');

    try {
      const result = await authClient.signIn.email({
        email,
        password,
      });

      if (result.error) {
        setError('Sign-in failed. Check your email and password and try again.');
        return;
      }

      const signInData = result.data as PasswordSignInData | null | undefined;
      if (signInData?.twoFactorRedirect === true) {
        if (!signInData.twoFactorMethods?.includes('totp')) {
          setError('This account requires an unsupported second factor. Contact an administrator.');
          return;
        }
        setTwoFactorRequired(true);
        return;
      }

      router.push('/');
    } catch {
      setError('Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleTotpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (!/^\d{6}$/.test(totpCode)) {
      setError('Enter the six-digit code from your authenticator.');
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: totpCode });
      if (result.error) {
        setError('That authenticator code is invalid or expired. Try the current code.');
        return;
      }

      router.push('/');
    } catch {
      setError('That authenticator code is invalid or expired. Try the current code.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-layout">
      <div className="auth-panel">
        <div className="shell-brand">
          <BrandMark />
          <span className="shell-brand-text">
            <span className="brand-name">Shanda Fuel</span>
            <span className="brand-byline">by ShandaHR</span>
          </span>
        </div>
        <Card as="section" className="auth-card" aria-labelledby="login-title">
          {twoFactorRequired ? (
            <div key="totp-step">
              <div className="section-heading">
                <h1 id="login-title">Verify your authenticator</h1>
                <p>Enter the current six-digit code from your authenticator app.</p>
              </div>

              <form
                className="demo-form"
                aria-label="Authenticator verification"
                onSubmit={handleTotpSubmit}
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
                    required
                  />
                </Field>

                {error ? (
                  <p className="field-error" role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="form-actions">
                  <Button type="submit" variant="primary" loading={loading}>
                    Verify code
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <div key="password-step">
              <div className="section-heading">
                <h1 id="login-title">Sign in</h1>
                <p>Use your assigned account to continue.</p>
              </div>

              <form className="demo-form" onSubmit={handlePasswordSubmit}>
                <Field id="email" label="Email" required>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    inputMode="email"
                    required
                  />
                </Field>

                <Field id="password" label="Password" required>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </Field>

                {error ? (
                  <p className="field-error" role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="form-actions">
                  <Button type="submit" variant="primary" loading={loading}>
                    Sign in
                  </Button>
                </div>
              </form>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
