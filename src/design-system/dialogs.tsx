'use client';

import {
  cloneElement,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { Checkbox } from './forms';
import { Icon } from './icons';
import { FOCUSABLE_SELECTOR, Modal } from './modal';
import { Button } from './primitives';

/* Confirmation ------------------------------------------------------------
 * Use only for financial, destructive, irreversible, or otherwise high-risk
 * commands. Ordinary low-risk actions must not get confirmation friction.
 *
 * The dialog is presentation only: the caller runs the server command in
 * `onConfirm`, owns `pending`/`error`, and closes the dialog on success.
 */

export type ConfirmTone = 'default' | 'warning' | 'danger';

export type ConfirmDetail = { label: string; value: ReactNode };

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  consequence,
  details,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  pending = false,
  error,
  acknowledgement,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Name the action and its object: "Approve reconciliation for 20 Sep 2026?" */
  title: string;
  /** What will happen, in plain terms, including whether it can be reversed. */
  consequence: ReactNode;
  /** Context the user must verify: station, business date, amount, revision. */
  details?: readonly ConfirmDetail[];
  /** Verb + object: "Approve reconciliation". Never "OK" or "Yes". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  pending?: boolean;
  error?: string;
  /** Optional explicit acknowledgement for irreversible actions. */
  acknowledgement?: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const ackId = useId();

  // Every opening starts unacknowledged, however the previous one closed
  // (cancel, Escape, or the caller closing it after a successful command).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setAcknowledged(false);
  }

  const close = () => {
    if (pending) return;
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      role="alertdialog"
      size="sm"
      dismissible={!pending}
      // Destructive and warning confirmations start on the safe choice.
      initialFocusRef={tone === 'default' ? undefined : cancelRef}
      leading={
        tone === 'default' ? null : (
          <span
            className={`confirm-icon confirm-icon-${tone === 'danger' ? 'critical' : 'warning'}`}
            aria-hidden="true"
          >
            <Icon name="warning" size="md" />
          </span>
        )
      }
      footer={
        <>
          <Button variant="secondary" ref={cancelRef} onClick={close} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={pending}
            disabled={Boolean(acknowledgement) && !acknowledged}
            data-autofocus={tone === 'default' ? true : undefined}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="confirm-consequence">{consequence}</div>
        {details && details.length > 0 ? (
          <dl className="confirm-details">
            {details.map((detail) => (
              <div key={detail.label}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {acknowledgement ? (
          <Checkbox
            id={ackId}
            label={acknowledgement}
            checked={acknowledged}
            disabled={pending}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
        ) : null}
        {error ? (
          <p className="field-error" role="alert">
            <Icon name="error" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/* Work in progress ----------------------------------------------------------
 * The one standard treatment for visible-but-unfinished features. Keep every
 * intended area visible; route unfinished actions and destinations here
 * instead of disabling them, hiding them, or letting them error.
 */

export const WORK_IN_PROGRESS_MESSAGE =
  'We are still completing this part of Shanda Fuel. It is shown so you can see where it will live. Nothing has been changed.';

export function WorkInProgressDialog({
  open,
  onClose,
  feature,
  message = WORK_IN_PROGRESS_MESSAGE,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  /** Business name of the feature, e.g. "Supplier statements". */
  feature: string;
  message?: string;
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${feature} is in progress`}
      size="sm"
      returnFocus={returnFocus}
      leading={
        <span className="wip-mark" aria-hidden="true">
          <Icon name="clock" size="md" />
        </span>
      }
      footer={
        <Button onClick={onClose} data-autofocus>
          Got it
        </Button>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

/**
 * Wraps any trigger (button, nav link, menu item) so activating it opens the
 * standard WIP dialog. The trigger keeps its normal look and stays focusable.
 */
export function WorkInProgressTrigger({
  feature,
  message,
  children,
}: {
  feature: string;
  message?: string;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const trigger = children as ReactElement<{
    onClick?: (event: MouseEvent<HTMLElement>) => void;
    'aria-haspopup'?: 'dialog';
  }>;

  return (
    <>
      <span className="modal-trigger" ref={containerRef}>
        {cloneElement(trigger, {
          'aria-haspopup': 'dialog',
          onClick: (event: MouseEvent<HTMLElement>) => {
            event.preventDefault();
            trigger.props.onClick?.(event);
            setOpen(true);
          },
        })}
      </span>
      <WorkInProgressDialog
        open={open}
        onClose={() => setOpen(false)}
        feature={feature}
        message={message}
        returnFocus={() => containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)}
      />
    </>
  );
}
