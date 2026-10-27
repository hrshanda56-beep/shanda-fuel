'use client';

import { useReverification } from '@clerk/nextjs';
import { useRef, useState } from 'react';

import { Modal } from '@/design-system/modal';
import { Button } from '@/design-system/primitives';

import styles from './setup.module.css';

type DialogProps = {
  open: boolean;
  tenantId: string;
  onVerified: () => void;
  onCancel: () => void;
  /** Wording for the action being confirmed; defaults to saving payment setup. */
  description?: string;
  confirmLabel?: string;
  cancelledMessage?: string;
};

type StepUpBody = { message?: string; clerk_error?: unknown };

/**
 * Privileged commands (such as creating a payment provider or exporting a report) need a fresh
 * step-up for this tenant. This dialog uses the existing `/api/auth/step-up` endpoint and adds no
 * new authentication behaviour.
 */
export function StepUpDialog(props: DialogProps) {
  const { open, onCancel } = props;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Confirm it is you"
      description={
        props.description ??
        'Saving payment setup needs a fresh identity check. Nothing is saved until you confirm.'
      }
      size="sm"
    >
      {/* Remount Clerk's reverification hook on every open. Clerk keeps challenge state in the
          hook, so retaining the old instance after cancel can turn the next attempt into a plain
          403 instead of opening the verification UI again. */}
      <ClerkForm key={open ? 'open' : 'closed'} {...props} />
    </Modal>
  );
}

function ClerkForm({
  tenantId,
  onVerified,
  onCancel,
  confirmLabel = 'Confirm and save',
  cancelledMessage = 'The check was cancelled or did not pass. Nothing was saved.',
}: DialogProps) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();

  return (
    <div className={styles.form}>
      <p className={styles.note}>You will be asked to confirm it&apos;s you.</p>
      {error ? (
        <p className={styles.message} role="alert">
          {error}
        </p>
      ) : null}
      <ReverificationAttempt
        key={attempt}
        tenantId={tenantId}
        onVerified={onVerified}
        onCancel={onCancel}
        confirmLabel={confirmLabel}
        onStarted={() => setError(undefined)}
        onFailed={() => {
          setError(cancelledMessage);
          // A failed code/cancel must get a fresh Clerk hook on the next click too.
          setAttempt((value) => value + 1);
        }}
      />
    </div>
  );
}

function ReverificationAttempt({
  tenantId,
  onVerified,
  onCancel,
  confirmLabel,
  onStarted,
  onFailed,
}: Pick<DialogProps, 'tenantId' | 'onVerified' | 'onCancel' | 'confirmLabel'> & {
  onStarted: () => void;
  onFailed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);

  const reverify = useReverification(async () => {
    const response = await fetch('/api/auth/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId, action: 'PRIVILEGED_OPERATION' }),
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
    onStarted();
    try {
      await reverify();
      onVerified();
    } catch {
      onFailed();
    } finally {
      submitted.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={styles.formActions}>
      <Button loading={busy} onClick={() => void verify()}>
        {confirmLabel}
      </Button>
      <Button variant="secondary" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
    </div>
  );
}
