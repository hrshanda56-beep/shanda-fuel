'use client';

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  children: ReactNode;
};

export function Button({
  variant = 'primary',
  className = '',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button-${variant} ${loading ? 'button-loading' : ''} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="button-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export type StatusTone =
  | 'positive'
  | 'neutral'
  | 'informational'
  | 'warning'
  | 'critical'
  | 'pending'
  | 'locked'
  | 'offline';

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

export function NumericInput({
  label,
  id,
  hint,
  error,
  required = false,
  optional = false,
  unit,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  hint?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  unit?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
        {optional && !required ? <span className="field-optional"> (optional)</span> : null}
      </label>
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      <div className="numeric-input-wrap">
        <input
          {...props}
          id={id}
          inputMode="decimal"
          type="text"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-required={required ? true : undefined}
          required={required || undefined}
        />
        {unit ? <span className="numeric-unit">{unit}</span> : null}
      </div>
      {error ? (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Card({
  as: Component = 'section',
  className = '',
  children,
  ...props
}: {
  as?: 'section' | 'article' | 'div';
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  return (
    <Component className={`card ${className}`.trim()} {...props}>
      {children}
    </Component>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  required = false,
  optional = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  children: ReactNode;
}) {
  const descriptionId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(
        children as ReactElement<{
          'aria-describedby'?: string;
          'aria-invalid'?: boolean;
          'aria-required'?: boolean;
          required?: boolean;
        }>,
        {
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : undefined,
          'aria-required': required ? true : undefined,
          required: required || undefined,
        },
      )
    : children;

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
        {optional && !required ? <span className="field-optional"> (optional)</span> : null}
      </label>
      {hint ? (
        <p className="field-hint" id={descriptionId}>
          {hint}
        </p>
      ) : null}
      <div>{control}</div>
      {error ? (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <span className="loading-dot" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-group" role="status" aria-label="Loading content">
      {Array.from({ length: lines }, (_, index) => (
        <span className={`skeleton-line skeleton-line-${index + 1}`} key={index} />
      ))}
    </div>
  );
}

export function ErrorState({
  title = 'Something needs attention',
  message,
  action,
}: {
  title?: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="state state-error" role="alert">
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
      {action ? <div className="state-action">{action}</div> : null}
    </div>
  );
}

export function SuccessState({ title = 'Saved', message }: { title?: string; message: string }) {
  return (
    <div className="state state-success" role="status" aria-live="polite">
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="state state-empty">
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
      {action ? <div className="state-action">{action}</div> : null}
    </div>
  );
}

export function ConflictState({
  message = 'This record changed elsewhere. Refresh before trying again.',
}: {
  message?: string;
}) {
  return (
    <div className="state state-conflict" role="status">
      <div>
        <h3>Review the latest version</h3>
        <p>{message}</p>
      </div>
    </div>
  );
}

export function AccessDeniedState({
  message = 'You do not have access to this area. Ask an authorised administrator if you need it.',
}: {
  message?: string;
}) {
  return (
    <div className="state state-access-denied" role="alert">
      <div>
        <h3>Access restricted</h3>
        <p>{message}</p>
      </div>
    </div>
  );
}

export function NotFoundState({
  message = 'The requested record is unavailable or may have moved.',
}: {
  message?: string;
}) {
  return (
    <div className="state state-not-found" role="status">
      <div>
        <h3>Not found</h3>
        <p>{message}</p>
      </div>
    </div>
  );
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ModalProps = {
  trigger: ReactElement;
  title: string;
  description?: string;
  children: ReactNode;
  presentation?: 'dialog' | 'sheet';
};

export function DialogFrame({
  trigger,
  title,
  description,
  children,
  presentation = 'dialog',
}: ModalProps) {
  const [open, setOpen] = useState(false);
  const triggerContainerRef = useRef<HTMLSpanElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const instanceId = useId().replace(/:/g, '');
  const titleId = `${slugify(title)}-${instanceId}-title`;
  const descriptionId = description ? `${slugify(title)}-${instanceId}-description` : undefined;
  const portalTarget = open && typeof document !== 'undefined' ? document.body : null;

  useEffect(() => {
    if (!open) return;

    const modalOverlay = document.querySelector<HTMLElement>('[data-modal-overlay="true"]');
    if (!modalOverlay) return;

    const triggerContainer = triggerContainerRef.current;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : (triggerContainer?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? null);
    const siblings = Array.from(document.body.children).filter((child) => child !== modalOverlay);
    const inertBefore = siblings.map((child) => ({
      child,
      inert: (child as HTMLElement & { inert?: boolean }).inert ?? false,
      ariaHidden: child.getAttribute('aria-hidden'),
    }));
    const bodyOverflow = document.body.style.overflow;

    siblings.forEach((child) => {
      (child as HTMLElement & { inert?: boolean }).inert = true;
      child.setAttribute('aria-hidden', 'true');
    });
    document.body.style.overflow = 'hidden';

    const focusDialog = () => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? dialogRef.current)?.focus();
    };
    const animationFrame = window.requestAnimationFrame(focusDialog);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = bodyOverflow;
      inertBefore.forEach(({ child, inert, ariaHidden }) => {
        (child as HTMLElement & { inert?: boolean }).inert = inert;
        if (ariaHidden === null) child.removeAttribute('aria-hidden');
        else child.setAttribute('aria-hidden', ariaHidden);
      });
      const restoreTarget =
        restoreFocusRef.current ?? triggerContainer?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      window.requestAnimationFrame(() => restoreTarget?.focus());
      restoreFocusRef.current = null;
    };
  }, [open]);

  const openDialog = () => {
    setOpen(true);
  };

  const triggerElement = trigger as ReactElement<{
    onClick?: (event: MouseEvent<HTMLElement>) => void;
  }>;

  return (
    <>
      <span className="modal-trigger" ref={triggerContainerRef}>
        {cloneElement(triggerElement, {
          onClick: (event: MouseEvent<HTMLElement>) => {
            triggerElement.props.onClick?.(event);
            if (!event.defaultPrevented) openDialog();
          },
        })}
      </span>
      {open && portalTarget
        ? createPortal(
            <div
              className={`dialog-backdrop ${presentation === 'sheet' ? 'dialog-backdrop-sheet' : ''}`.trim()}
              data-modal-overlay="true"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <section
                className={`dialog-panel ${presentation === 'sheet' ? 'bottom-sheet' : ''}`.trim()}
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                tabIndex={-1}
              >
                {presentation === 'sheet' ? (
                  <span className="sheet-handle" aria-hidden="true" />
                ) : null}
                <div className="dialog-heading">
                  <div>
                    <h2 id={titleId}>{title}</h2>
                    {description ? <p id={descriptionId}>{description}</p> : null}
                  </div>
                  <button
                    className="dialog-close"
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label={`Close ${title}`}
                  >
                    ×
                  </button>
                </div>
                {children}
              </section>
            </div>,
            portalTarget,
          )
        : null}
    </>
  );
}

export function BottomSheet({
  trigger,
  title,
  description,
  children,
}: Omit<ModalProps, 'presentation'>) {
  return (
    <DialogFrame trigger={trigger} title={title} description={description} presentation="sheet">
      {children}
    </DialogFrame>
  );
}

export function RiskConfirmation({
  title,
  consequence,
  actionLabel,
}: {
  title: string;
  consequence: string;
  actionLabel: string;
}) {
  return (
    <div className="risk-confirmation" role="group" aria-labelledby="risk-confirmation-title">
      <div>
        <StatusBadge tone="warning">Review consequence</StatusBadge>
        <h3 id="risk-confirmation-title">{title}</h3>
        <p>{consequence}</p>
      </div>
      <Button type="button" variant="danger">
        {actionLabel}
      </Button>
    </div>
  );
}

type EvidenceState = 'pending' | 'uploading' | 'failed' | 'verified' | 'available';

export function EvidenceFile({
  name,
  state,
  detail,
}: {
  name: string;
  state: EvidenceState;
  detail?: string;
}) {
  const tone: StatusTone =
    state === 'failed'
      ? 'critical'
      : state === 'verified' || state === 'available'
        ? 'positive'
        : 'pending';

  return (
    <div className="evidence-file">
      <div>
        <strong>{name}</strong>
        {detail ? <p>{detail}</p> : null}
      </div>
      <StatusBadge tone={tone}>{formatEvidenceState(state)}</StatusBadge>
    </div>
  );
}

function formatEvidenceState(state: EvidenceState) {
  return state === 'verified'
    ? 'Verified'
    : state === 'available'
      ? 'Available'
      : state.charAt(0).toUpperCase() + state.slice(1);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function OfflineBanner() {
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <StatusBadge tone="offline">Offline draft mode</StatusBadge>
      <span>
        Drafts can be saved on this device. Authoritative actions require confirmation online.
      </span>
    </div>
  );
}
