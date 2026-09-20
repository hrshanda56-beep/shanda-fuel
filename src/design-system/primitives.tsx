import {
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  return (
    <button className={`button button-${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

type StatusTone = 'positive' | 'neutral' | 'warning' | 'critical' | 'offline';

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`status status-${tone}`}>{children}</span>;
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
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const descriptionId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(
        children as ReactElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>,
        {
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : undefined,
        },
      )
    : children;

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
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
