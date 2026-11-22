'use client';

import {
  cloneElement,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { Icon } from './icons';
import { FOCUSABLE_SELECTOR, Modal } from './modal';
import { Button } from './primitives';
import { WizardConfirm } from './wizard-kit';

/* Confirmation ------------------------------------------------------------
 * Shown as the standard page card (WizardConfirm), not a small pop-up.
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
  const close = () => {
    if (pending) return;
    onClose();
  };

  // The same page card as every guided flow (see `WizardConfirm`). It is remounted on each opening,
  // so an acknowledgement tick never carries over from a previous one.
  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      role="alertdialog"
      presentation="page"
      dismissible={!pending}
    >
      <WizardConfirm
        title={title}
        consequence={consequence}
        details={details}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        tone={tone}
        acknowledgement={acknowledgement}
        busy={pending}
        error={error}
        onConfirm={onConfirm}
        onCancel={close}
      />
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
