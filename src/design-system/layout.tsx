import Link from 'next/link';
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
  headingLevel = 'h1',
}: {
  title: string;
  /** Short context above the title, e.g. station or module. */
  eyebrow?: string;
  description?: ReactNode;
  /** At most one primary action; secondary actions as secondary/quiet buttons. */
  actions?: ReactNode;
  titleId?: string;
  headingLevel?: 'h1' | 'h2';
}) {
  const Heading = headingLevel;
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <Heading id={titleId}>{title}</Heading>
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
 * One key number (KPI): a label, a value and an optional line of context.
 * Values are display strings from server responses or the presentation
 * formatters; this component never calculates.
 *
 * KPIs never carry icons. When the number has a detail view, pass `href` and
 * the whole card becomes the link to it (another page or an in-page section).
 */
export function MetricCard({
  label,
  value,
  meta,
  tone = 'default',
  href,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  tone?: 'default' | 'critical';
  /** Where the detail behind this number lives, e.g. `#cash` or `/reports`. */
  href?: string;
}) {
  const content = (
    <>
      <span className="metric-label">{label}</span>
      <strong className={`metric-value ${tone === 'critical' ? 'metric-critical' : ''}`.trim()}>
        {value}
      </strong>
      {meta ? <span className="metric-meta">{meta}</span> : null}
    </>
  );
  return href ? (
    <Link className="card metric-card" href={href}>
      {content}
    </Link>
  ) : (
    <div className="card metric-card">{content}</div>
  );
}
