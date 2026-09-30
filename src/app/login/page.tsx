'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/platform/auth/client';
import { Button, Card, Field } from '@/design-system/primitives';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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

      router.push('/');
    } catch {
      setError('Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-layout">
      <div className="auth-panel">
        <div className="shell-brand">
          <span className="brand-mark" aria-hidden="true">
            SF
          </span>
          <span className="shell-brand-text">
            <span className="brand-name">Shanda Fuel</span>
            <span className="brand-byline">by ShandaHR</span>
          </span>
        </div>
        <Card as="section" className="auth-card" aria-labelledby="login-title">
          <div className="section-heading">
            <h1 id="login-title">Sign in</h1>
            <p>Use your assigned account to continue.</p>
          </div>

          <form className="demo-form" onSubmit={handleSubmit}>
            <Field id="email" label="Email" required>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                inputMode="email"
              />
            </Field>

            <Field id="password" label="Password" required>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
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
        </Card>
      </div>
    </main>
  );
}
