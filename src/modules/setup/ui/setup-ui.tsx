'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Modal } from '@/design-system/modal';
import { Button } from '@/design-system/primitives';

import type { CommandResult } from './setup-api';
import styles from './setup.module.css';

export function SetupSection({
  id,
  title,
  note,
  action,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={styles.sectionHeader}>
        <div>
          <h3 id={`${id}-title`} className={styles.sectionTitle}>
            {title}
          </h3>
          {note ? <p className={styles.note}>{note}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** A "Not entered" empty state. Never renders a zero. */
export function NotEntered({ what, hint }: { what: string; hint?: string }) {
  return (
    <div className={styles.notEntered}>
      <p className={styles.notEnteredTitle}>Not entered</p>
      <p className={styles.note}>{hint ?? `No ${what} has been entered yet.`}</p>
    </div>
  );
}

export function RowList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.rows} aria-label={label}>
      {children}
    </ul>
  );
}

export function Row({
  title,
  badge,
  details,
  actions,
  onOpen,
  openLabel,
}: {
  title: ReactNode;
  badge?: ReactNode;
  details?: ReadonlyArray<{ label: string; value: ReactNode }>;
  actions?: ReactNode;
  /** Makes the whole row a button (edit); `openLabel` names it for assistive tech. */
  onOpen?: () => void;
  openLabel?: string;
}) {
  const content = (
    <>
      <span className={styles.rowHead}>
        <span className={styles.rowTitle}>{title}</span>
        {badge}
      </span>
      {details && details.length > 0 ? (
        <dl className={styles.rowDetails}>
          {details.map((detail) => (
            <div key={detail.label}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  );
  return (
    <li className={styles.row}>
      {onOpen ? (
        <button type="button" className={styles.rowButton} onClick={onOpen} aria-label={openLabel}>
          {content}
        </button>
      ) : (
        <div className={styles.rowBody}>{content}</div>
      )}
      {actions ? <div className={styles.rowActions}>{actions}</div> : null}
    </li>
  );
}

/**
 * Side-sheet form. `onSubmit` returns the command result; on failure the
 * message stays inside the form (role=alert) and the idempotency key is kept
 * so a retry cannot duplicate; on success the key is replaced.
 */
export function FormModal({
  open,
  title,
  description,
  submitLabel,
  onClose,
  onSubmit,
  onDone,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (form: FormData, idempotencyKey: string) => Promise<CommandResult>;
  onDone: () => void;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const key = useRef<string>(crypto.randomUUID());
  const submitting = useRef(false);
  const formId = `setup-form-${title.replace(/\W+/g, '-').toLowerCase()}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await onSubmit(new FormData(event.currentTarget), key.current);
      if (result.ok) {
        key.current = crypto.randomUUID();
        onDone();
      } else {
        setError(result.message);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    setError(undefined);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      description={description}
      presentation="side"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate={false}>
        {children}
        {error ? (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

export function text(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}
