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
      <ClerkForm {...props} />
    </Modal>
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
