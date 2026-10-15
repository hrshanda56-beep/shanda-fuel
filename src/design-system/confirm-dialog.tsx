'use client';

import type { ReactNode } from 'react';

import { Modal } from './modal';
import { Button } from './primitives';

export type ConfirmLine = Readonly<{ label: string; value: ReactNode }>;

/**
 * Asked before anything that cannot be quietly undone. A short summary of what is about to happen, then
 * Cancel (secondary) and the action (primary). The dialog stays open, with the button busy, while the
 * action runs so a double tap cannot send it twice.
 */
export function ConfirmDialog({
  open,
  title,
  lines,
  note,
  confirmLabel,
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  lines?: readonly ConfirmLine[];
  note?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      role="alertdialog"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} loading={busy} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {lines && lines.length > 0 ? (
        <dl className="confirm-lines">
          {lines.map((line) => (
            <div key={line.label}>
              <dt>{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {note ? <p className="confirm-note">{note}</p> : null}
      {children}
    </Modal>
  );
}
