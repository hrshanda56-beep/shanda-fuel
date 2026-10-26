'use client';

import { useReverification } from '@clerk/nextjs';
import { useEffect, useRef, useState } from 'react';

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
      <ClerkForm {...props} />
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submitted = useRef(false);
  const silentTried = useRef(false);

  // If an identity check is still active (or the person has just signed in), the server says so
  // straight away and nothing needs to be asked. Otherwise the button below is shown as before.
  useEffect(() => {
    if (silentTried.current) return;
    silentTried.current = true;
    void (async () => {
      try {
        const response = await fetch('/api/auth/step-up', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenantId, action: 'PRIVILEGED_OPERATION' }),
        });
        if (response.ok) onVerified();
      } catch {
        // Offline or blocked: the person can still use the button.
      }
    })();
  }, [tenantId, onVerified]);

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
    setError(undefined);
    try {
      await reverify();
      onVerified();
    } catch {
      setError(cancelledMessage);
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
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
