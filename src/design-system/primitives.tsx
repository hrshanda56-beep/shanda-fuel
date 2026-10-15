'use client';

import {
  cloneElement,
  isValidElement,
  useRef,
  useState,
  type HTMLAttributes,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

import { Icon, type IconName } from './icons';
import { FOCUSABLE_SELECTOR, Modal } from './modal';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ControlSize = 'sm' | 'md' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ControlSize;
  /** Full-width button, e.g. the primary action of a phone form. */
  block?: boolean;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className = '',
  loading = false,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = [
    'button',
    `button-${variant}`,
    size !== 'md' ? `button-${size}` : '',
    block ? 'button-block' : '',
    loading ? 'button-loading' : '',
    className,
  ];
  return (
    <button
      className={classes.filter(Boolean).join(' ')}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="button-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Accessible name. Required: an icon alone never labels a control. */
  label: string;
  icon: IconName;
  size?: 'sm' | 'md';
  variant?: 'quiet' | 'outlined';
};

export function IconButton({
  label,
  icon,
  size = 'md',
  variant = 'quiet',
  className = '',
  type = 'button',
  ...props
}: IconButtonProps) {
  const classes = [
    'icon-button',
    size === 'sm' ? 'icon-button-sm' : '',
    variant === 'outlined' ? 'icon-button-outlined' : '',
    className,
  ];
  return (
    <button
      className={classes.filter(Boolean).join(' ')}
      type={type}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} />
    </button>
  );
}

export type StatusTone =
  | 'positive'
  | 'neutral'
  | 'informational'
  | 'progress'
  | 'warning'
  | 'critical'
  | 'pending'
  | 'locked'
  | 'offline';

export function StatusBadge({
  tone,
  plain = false,
  children,
  ...props
}: {
  tone: StatusTone;
  /** Hide the leading dot, e.g. inside dense tables with many badges. */
  plain?: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`status status-${tone} ${plain ? 'status-plain' : ''}`.trim()} {...props}>
      {children}
    </span>
  );
}

function FieldLabel({
  htmlFor,
  label,
  required,
  optional,
}: {
  htmlFor: string;
  label: string;
  required: boolean;
  optional: boolean;
}) {
  return (
    <label htmlFor={htmlFor}>
      {label}
      {required ? (
        <span className="field-required" aria-hidden="true">
          {' '}
          *
        </span>
      ) : null}
      {optional && !required ? <span className="field-optional"> (optional)</span> : null}
    </label>
  );
}

function FieldError({ id, error }: { id?: string; error?: string }) {
  if (!error) return null;
  return (
    <p className="field-error" id={id} role="alert">
      <Icon name="error" />
      <span>{error}</span>
    </p>
  );
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
      <FieldLabel htmlFor={id} label={label} required={required} optional={optional} />
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
      <FieldError id={errorId} error={error} />
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
      <FieldLabel htmlFor={id} label={label} required={required} optional={optional} />
      {hint ? (
        <p className="field-hint" id={descriptionId}>
          {hint}
        </p>
      ) : null}
      <div>{control}</div>
      <FieldError id={errorId} error={error} />
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

export function Skeleton({
  lines = 3,
  label = 'Loading content',
}: {
  lines?: number;
  label?: string;
}) {
  return (
    <div className="skeleton-group" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <span className={`skeleton-line skeleton-line-${index + 1}`} key={index} />
      ))}
    </div>
  );
}

/** A single skeleton shape for mirroring real layout (cards, avatars, chart areas). */
export function SkeletonBlock({
  width = '100%',
  height = '1rem',
  shape = 'rect',
}: {
  width?: string;
  height?: string;
  shape?: 'rect' | 'circle';
}) {
  return (
    <span
      className={`skeleton ${shape === 'circle' ? 'skeleton-circle' : ''}`.trim()}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

type StateLayout = 'inline' | 'block';
/** Block states that are the whole page (route error / not found) use 1. */
type StateHeadingLevel = 1 | 2 | 3;

/**
 * Centred, spacious presentation for a whole region or page. Inline states
 * (the default) sit compactly inside an existing surface.
 */
function StateBlock({
  icon,
  title,
  message,
  action,
  secondaryAction,
  tone,
  role,
  headingLevel = 3,
}: {
  icon: IconName;
  title: string;
  message: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  tone: 'neutral' | 'error';
  role?: 'alert' | 'status';
  headingLevel?: StateHeadingLevel;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={`state-block ${tone === 'error' ? 'state-block-error' : ''}`.trim()}
      role={role}
    >
      <span className="state-icon" aria-hidden="true">
        <Icon name={icon} size="md" />
      </span>
      <Heading>{title}</Heading>
      <p>{message}</p>
      {action || secondaryAction ? (
        <div className="state-actions">
          {secondaryAction ? (
            <span className="state-action-secondary">{secondaryAction}</span>
          ) : null}
          {action ? <span className="state-action">{action}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something needs attention',
  message,
  action,
  secondaryAction,
  layout = 'inline',
  headingLevel,
}: {
  title?: string;
  message: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  layout?: StateLayout;
  headingLevel?: StateHeadingLevel;
}) {
  if (layout === 'block') {
    return (
      <StateBlock
        icon="error"
        tone="error"
        role="alert"
        title={title}
        message={message}
        action={action}
        secondaryAction={secondaryAction}
        headingLevel={headingLevel}
      />
    );
  }
  return (
    <div className="state state-error" role="alert">
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
      {action || secondaryAction ? (
        <div className="state-actions">
          {secondaryAction ? (
            <span className="state-action-secondary">{secondaryAction}</span>
          ) : null}
          {action ? <span className="state-action">{action}</span> : null}
        </div>
      ) : null}
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
  secondaryAction,
  layout = 'inline',
  icon = 'inbox',
  headingLevel,
}: {
  title: string;
  message: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  layout?: StateLayout;
  icon?: IconName;
  headingLevel?: StateHeadingLevel;
}) {
  if (layout === 'block') {
    return (
      <StateBlock
        icon={icon}
        tone="neutral"
        title={title}
        message={message}
        action={action}
        secondaryAction={secondaryAction}
        headingLevel={headingLevel}
      />
    );
  }
  return (
    <div className="state state-empty">
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
      {action || secondaryAction ? (
        <div className="state-actions">
          {secondaryAction ? (
            <span className="state-action-secondary">{secondaryAction}</span>
          ) : null}
          {action ? <span className="state-action">{action}</span> : null}
        </div>
      ) : null}
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

/** A calm, non-interactive state for pages waiting on an authorised context. */
export function ContextRequiredState({
  title,
  message,
  headingLevel = 2,
}: {
  title: string;
  message: string;
  headingLevel?: 1 | 2 | 3;
}) {
  return (
    <EmptyState
      layout="block"
      icon="building"
      title={title}
      message={message}
      headingLevel={headingLevel}
    />
  );
}

type ModalProps = {
  trigger: ReactElement;
  title: string;
  description?: string;
  children: ReactNode;
  presentation?: 'dialog' | 'sheet';
};

/**
 * Trigger-owned dialog: clones `trigger` to open it. Use `Modal` directly when
 * the open state belongs to the caller (e.g. after a command succeeds).
 */
export function DialogFrame({
  trigger,
  title,
  description,
  children,
  presentation = 'dialog',
}: ModalProps) {
  const [open, setOpen] = useState(false);
  const triggerContainerRef = useRef<HTMLSpanElement>(null);

  const triggerElement = trigger as ReactElement<{
    onClick?: (event: MouseEvent<HTMLElement>) => void;
  }>;

  return (
    <>
      <span className="modal-trigger" ref={triggerContainerRef}>
        {cloneElement(triggerElement, {
          onClick: (event: MouseEvent<HTMLElement>) => {
            triggerElement.props.onClick?.(event);
            if (!event.defaultPrevented) setOpen(true);
          },
        })}
      </span>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        presentation={presentation}
        returnFocus={() =>
          triggerContainerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        }
      >
        {children}
      </Modal>
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
