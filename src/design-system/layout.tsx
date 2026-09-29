import type { ReactNode } from 'react';

/**
 * Page and content composition. Every screen answers, in order:
 * where am I (eyebrow + title), what matters (description, attention),
 * and what can I do next (actions, one primary).
 */

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  titleId = 'page-title',
}: {
  title: string;
  /** Short context above the title, e.g. station or module. */
  eyebrow?: string;
  description?: ReactNode;
  /** At most one primary action; secondary actions as secondary/quiet buttons. */
  actions?: ReactNode;
  titleId?: string;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 id={titleId}>{title}</h1>
        {description ? <p className="lede">{description}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}

/**
 * Width-constrained page region. `narrow` for focused forms, `default` for
 * workspaces, `wide` for dense reconciliation and reporting.
 */
export function PageContainer({
  width = 'default',
  children,
  className = '',
}: {
  width?: 'narrow' | 'default' | 'wide';
  children: ReactNode;
  className?: string;
}) {
  const widthClass = width === 'default' ? '' : `page-${width}`;
  return (
    <div className={`page ${widthClass} ${className}`.replace(/\s+/g, ' ').trim()}>{children}</div>
  );
}

/** A section with a quiet heading row and optional trailing action. */
export function Section({
  title,
  description,
  action,
  children,
  headingId,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  headingId?: string;
}) {
  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="panel-heading">
        <div>
          <h2 id={headingId}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One key number. Values are display strings from server responses or the
 * presentation formatters; this component never calculates.
 */
export function MetricCard({
  label,
  value,
  meta,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  tone?: 'default' | 'critical';
}) {
  return (
    <div className="card metric-card">
      <span className="metric-label">{label}</span>
      <strong className={`metric-value ${tone === 'critical' ? 'metric-critical' : ''}`.trim()}>
        {value}
      </strong>
      {meta ? <span className="metric-meta">{meta}</span> : null}
    </div>
  );
}
