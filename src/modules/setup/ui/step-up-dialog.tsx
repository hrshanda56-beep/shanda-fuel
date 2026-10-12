'use client';

import { useReverification } from '@clerk/nextjs';
import { useRef, useState, type FormEvent } from 'react';

import { Modal } from '@/design-system/modal';
import { Button, Field } from '@/design-system/primitives';

import styles from './setup.module.css';

export type StepUpProvider = 'BETTER_AUTH' | 'CLERK';

type DialogProps = {
  open: boolean;
  tenantId: string;
  provider: StepUpProvider;
  onVerified: () => void;
  onCancel: () => void;
};

type StepUpBody = { message?: string; clerk_error?: unknown };

/**
 * Creating a payment provider or account is a privileged command, so the server
 * requires a fresh step-up for this tenant. This dialog uses the existing
 * `/api/auth/step-up` endpoint and adds no new authentication behaviour.
 */
export function StepUpDialog(props: DialogProps) {
  const { open, onCancel } = props;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Confirm it is you"
      description="Saving payment setup needs a fresh identity check. Nothing is saved until you confirm."
      size="sm"
    >
      {props.provider === 'CLERK' ? <ClerkForm {...props} /> : <BetterAuthForm {...props} />}
    </Modal>
  );
}

function BetterAuthForm({ tenantId, onVerified, onCancel }: DialogProps) {
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch('/api/auth/step-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, password, totpCode }),
      });
      const body = (await response.json().catch(() => ({}))) as StepUpBody;
      if (!response.ok) {
        setError(body.message ?? 'The check did not pass. Nothing was saved.');
        return;
      }
      setPassword('');
      setTotpCode('');
      onVerified();
    } catch {
      setError('The check could not reach the server. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => void verify(event)}
      aria-label="Confirm it is you"
    >
      <Field id="setup-step-up-password" label="Current password" required>
        <input
          id="setup-step-up-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </Field>
      <Field id="setup-step-up-totp" label="Authenticator code" required>
        <input
          id="setup-step-up-totp"
          inputMode="numeric"
          pattern="[0-9]{6}"
          autoComplete="one-time-code"
          value={totpCode}
          onChange={(event) => setTotpCode(event.target.value)}
          disabled={busy}
        />
      </Field>
      {error ? (
        <p className={styles.message} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.formActions}>
        <Button
          type="submit"
          loading={busy}
          disabled={password.length === 0 || totpCode.length !== 6}
        >
          Confirm and save
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ClerkForm({ tenantId, onVerified, onCancel }: DialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submitted = useRef(false);
  const reverify = useReverification(async () => {
    const response = await fetch('/api/auth/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId, action: 'LOCK_BUSINESS_DAY' }),
    });
    const body = (await response.json().catch(() => ({}))) as StepUpBody;
    if (!response.ok) {
      if (body.clerk_error) return body;
      throw new Error(body.message ?? 'The check did not pass.');
    }
    return body;
  });

  async function verify() {
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await reverify();
      onVerified();
    } catch {
      setError('The check was cancelled or did not pass. Nothing was saved.');
    } finally {
      submitted.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={styles.form}>
      <p className={styles.note}>You will be asked to reverify your password.</p>
      {error ? (
        <p className={styles.message} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.formActions}>
        <Button loading={busy} onClick={() => void verify()}>
          Confirm and save
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
