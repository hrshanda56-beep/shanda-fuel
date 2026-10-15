'use client';

import { useClerk, useReverification } from '@clerk/nextjs';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Modal } from '../../../design-system/modal';
import { Button, Field } from '../../../design-system/primitives';

type Props = { tenantId: string; disabled?: boolean; onVerified: () => void };
type StepUpResponse = { status?: string; message?: string; clerk_error?: unknown };

/** Identity verification is separate from approval: the command still checks
 * permission, tenant, action, assurance expiry and the reviewed record version. */
export function ReconciliationApprovalButton({ tenantId, disabled, onVerified }: Props) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<'BETTER_AUTH' | 'CLERK'>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const attempt = useRef(0);
  const [activeAttempt, setActiveAttempt] = useState(0);
  useEffect(
    () => () => {
      ++attempt.current;
    },
    [],
  );

  async function begin() {
    const current = ++attempt.current;
    setActiveAttempt(current);
    setOpen(true);
    setProvider(undefined);
    setError(undefined);
    setLoading(true);
    try {
      // This endpoint deliberately returns 404 for Clerk. Other failures must
      // remain failures; an unavailable service is not provider detection.
      const response = await fetch('/api/auth/mfa/setup', { cache: 'no-store' });
      if (attempt.current !== current) return;
      if (response.status === 404) setProvider('CLERK');
      else if (response.ok) {
        const body = (await response.json()) as { enabled?: boolean };
        if (attempt.current !== current) return;
        setMfaEnabled(body.enabled === true);
        setProvider('BETTER_AUTH');
      } else
        setError('Your authentication status could not be loaded. Close this dialog and retry.');
    } catch {
      if (attempt.current === current)
        setError('Your authentication status could not be loaded. Close this dialog and retry.');
    } finally {
      if (attempt.current === current) setLoading(false);
    }
  }
  function cancel() {
    ++attempt.current;
    setOpen(false);
  }
  function verified() {
    if (activeAttempt !== attempt.current || !open) return;
    ++attempt.current;
    setOpen(false);
    onVerified();
  }
  return (
    <>
      <Button variant="primary" disabled={disabled || open} onClick={() => void begin()}>
        Approve production reconciliation
      </Button>
      <Modal
        open={open}
        onClose={cancel}
        title="Verify identity for approval"
        description="Confirm your password and MFA before reviewing the final approval. No reconciliation is approved by this identity check."
        size="sm"
      >
        {loading ? <p role="status">Loading authentication…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {open && provider === 'BETTER_AUTH' ? (
          <BetterAuthApproval
            enrolled={mfaEnabled}
            tenantId={tenantId}
            onVerified={verified}
            onCancel={cancel}
          />
        ) : null}
        {open && provider === 'CLERK' ? (
          <ClerkApproval tenantId={tenantId} onVerified={verified} onCancel={cancel} />
        ) : null}
      </Modal>
    </>
  );
}

type FormProps = { tenantId: string; onVerified: () => void; onCancel: () => void };

function BetterAuthApproval({
  tenantId,
  onVerified,
  onCancel,
  enrolled,
}: FormProps & { enrolled: boolean }) {
  const prefix = useId();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [enrollment, setEnrollment] = useState<{ totpURI: string; backupCodes: string[] }>();
  const [enrolling, setEnrolling] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(enrolled);
  const submitted = useRef(false);

  async function post(path: string, body: unknown) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as StepUpResponse & {
      totpURI?: string;
      backupCodes?: string[];
    };
    if (!response.ok)
      throw new Error(
        result.message ?? 'Verification failed. Check your password and authenticator code.',
      );
    return result;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (enrollment) {
        await post('/api/auth/mfa/setup/verify', { code });
        setEnrollment(undefined);
        setIsEnrolled(true);
        setEnrolling(false);
        setCode('');
        return;
      }
      const result = await post('/api/auth/step-up', { tenantId, password, totpCode: code });
      if (result.status !== 'active')
        throw new Error('Verification was not established. Retry before approving.');
      setPassword('');
      setCode('');
      onVerified();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Verification could not be completed.');
    } finally {
      submitted.current = false;
      setBusy(false);
    }
  }
  async function enroll() {
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await post('/api/auth/mfa/setup', { password });
      if (!result.totpURI || !result.backupCodes)
        throw new Error('Authenticator setup could not be started.');
      setEnrollment({ totpURI: result.totpURI, backupCodes: result.backupCodes });
      setEnrolling(true);
      setCode('');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Authenticator setup could not be started.',
      );
    } finally {
      submitted.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Verify reconciliation approval">
      <Field id={`${prefix}-password`} label="Current password" required>
        <input
          id={`${prefix}-password`}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
        />
      </Field>
      {enrollment ? (
        <div className="state">
          <p>
            Add this account to your authenticator and save these recovery codes before continuing.
          </p>
          <a href={enrollment.totpURI}>Open authenticator setup</a>
          <p>
            Setup key:{' '}
            <code style={{ overflowWrap: 'anywhere' }}>
              {new URL(enrollment.totpURI).searchParams.get('secret')}
            </code>
          </p>
          <p style={{ overflowWrap: 'anywhere' }}>
            Recovery codes: {enrollment.backupCodes.join(' · ')}
          </p>
        </div>
      ) : null}
      <Field id={`${prefix}-code`} label="Authenticator code" required>
        <input
          id={`${prefix}-code`}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
          disabled={busy}
        />
      </Field>
      {error ? <p role="alert">{error}</p> : null}
      <div className="form-actions">
        <Button type="submit" loading={busy} disabled={busy || !password || !/^\d{6}$/.test(code)}>
          {enrolling ? 'Confirm authenticator enrollment' : 'Verify identity'}
        </Button>
        {!enrollment && !isEnrolled ? (
          <Button variant="secondary" disabled={busy || !password} onClick={() => void enroll()}>
            Set up authenticator
          </Button>
        ) : null}
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p>
        Use an enrolled authenticator. If you have not enrolled, enter your current password and
        choose Set up authenticator.
      </p>
    </form>
  );
}

function ClerkApproval({ tenantId, onVerified, onCancel }: FormProps) {
  const { openUserProfile } = useClerk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submitted = useRef(false);
  const reverify = useReverification(async () => {
    const response = await fetch('/api/auth/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId, action: 'APPROVE_RECONCILIATION' }),
    });
    const body = (await response.json()) as StepUpResponse;
    if (!response.ok) {
      if (body.clerk_error) return body;
      throw new Error(body.message ?? 'Verification did not pass.');
    }
    return body;
  });
  async function verify() {
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await reverify();
      if (result?.status !== 'active')
        throw new Error('Identity verification was cancelled or did not pass.');
      onVerified();
    } catch {
      setError(
        'Verification did not complete. An enrolled MFA method is required. Manage account MFA if needed, then retry.',
      );
    } finally {
      submitted.current = false;
      setBusy(false);
    }
  }
  return (
    <div>
      <p>Approval requires a fresh password and MFA check through your account provider.</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="form-actions">
        <Button loading={busy} disabled={busy} onClick={() => void verify()}>
          Verify identity
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            onCancel();
            openUserProfile();
          }}
        >
          Manage account MFA
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
