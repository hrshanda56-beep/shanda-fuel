'use client';

import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';

import { Icon, type IconName } from './icons';
import { IconButton } from './primitives';

/* Notice ------------------------------------------------------------------ */

export type NoticeTone = 'neutral' | 'info' | 'positive' | 'warning' | 'critical' | 'offline';

const noticeIcons: Record<NoticeTone, IconName> = {
  neutral: 'info',
  info: 'info',
  positive: 'check-circle',
  warning: 'warning',
  critical: 'error',
  offline: 'wifi-off',
};

/**
 * Inline notification for a region or page. Critical and warning notices are
 * announced assertively/politely; others are passive. Dismissal is local
 * presentation only — it never acknowledges or resolves a server state.
 */
export function Notice({
  tone = 'neutral',
  title,
  children,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
}: {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const role = tone === 'critical' ? 'alert' : tone === 'warning' ? 'status' : undefined;
  return (
    <div className={`notice notice-${tone}`} role={role}>
      <span className="notice-icon">
        <Icon name={noticeIcons[tone]} />
      </span>
      <div className="notice-body">
        {title ? <p className="notice-title">{title}</p> : null}
        {typeof children === 'string' ? <p>{children}</p> : children}
        {actions ? <div className="notice-actions">{actions}</div> : null}
      </div>
      {onDismiss ? (
        <IconButton icon="close" label={dismissLabel} size="sm" onClick={onDismiss} />
      ) : (
        <span />
      )}
    </div>
  );
}

/* Needs attention --------------------------------------------------------- */

export type AttentionPriority = 'critical' | 'warning' | 'info';

export type AttentionItem = {
  id: string;
  priority: AttentionPriority;
  title: string;
  detail?: string;
  /** Context such as station, business date, or age ("Harare Rd · 2h ago"). */
  meta?: string;
  /**
   * Where the work lives. The whole item becomes a link to it, so the user
   * can click anywhere on the row.
   */
  href?: string;
  /** The single next action, rendered as a link or button by the caller. */
  action?: ReactNode;
  /** Only for items that may be hidden without resolving anything. */
  dismissible?: boolean;
};

const priorityRank: Record<AttentionPriority, number> = { critical: 0, warning: 1, info: 2 };
const priorityLabel: Record<AttentionPriority, string> = {
  critical: 'Critical',
  warning: 'Needs review',
  info: 'For information',
};

/**
 * Action-first "Needs attention" list. Items are ordered by priority, the
 * list is capped (`limit`) so it never dominates a page, and overflow goes to
 * `viewAll`. Dismissal hides an item for this view only; the server decides
 * what genuinely needs attention.
 */
export function NeedsAttention({
  items,
  title = 'Needs attention',
  limit = 5,
  viewAll,
  onDismiss,
  emptyMessage = 'Nothing needs your attention right now.',
  headingLevel = 2,
}: {
  items: readonly AttentionItem[];
  title?: string;
  limit?: number;
  viewAll?: ReactNode;
  onDismiss?: (id: string) => void;
  emptyMessage?: string;
  headingLevel?: 2 | 3;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const visible = items
    .filter((item) => !dismissed.has(item.id))
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
  const shown = visible.slice(0, limit);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  // Unique per instance: a page may show more than one attention list.
  const headingId = `attention-${useId().replace(/:/g, '')}`;

  const dismiss = (id: string) => {
    setDismissed((current) => new Set(current).add(id));
    onDismiss?.(id);
  };

  return (
    <section className="attention" aria-labelledby={headingId}>
      <div className="attention-header">
        <Heading className="attention-title" id={headingId}>
          {title}{' '}
          {visible.length > 0 ? (
            <span className="attention-count">
              {visible.length}
              <span className="visually-hidden">{visible.length === 1 ? ' item' : ' items'}</span>
            </span>
          ) : null}
        </Heading>
      </div>
      {shown.length === 0 ? (
        <p className="attention-empty">
          <Icon name="check-circle" />
          {emptyMessage}
        </p>
      ) : (
        <ul className="attention-list">
          {shown.map((item) => (
            <li className={`attention-item attention-item-${item.priority}`} key={item.id}>
              <span className="attention-indicator" aria-hidden="true" />
              <div>
                <p className="attention-item-title">
                  {item.href ? (
                    <Link className="attention-item-link" href={item.href}>
                      <span className="visually-hidden">{priorityLabel[item.priority]}: </span>
                      {item.title}
                    </Link>
                  ) : (
                    <>
                      <span className="visually-hidden">{priorityLabel[item.priority]}: </span>
                      {item.title}
                    </>
                  )}
                </p>
                {item.detail ? <p className="attention-item-detail">{item.detail}</p> : null}
                {item.meta ? <span className="attention-item-meta">{item.meta}</span> : null}
              </div>
              <div className="attention-item-actions">
                {item.action}
                {item.href && !item.action ? (
                  <Icon name="chevron-right" className="attention-item-go" />
                ) : null}
                {item.dismissible ? (
                  <IconButton
                    icon="close"
                    size="sm"
                    label={`Dismiss ${item.title}`}
                    onClick={() => dismiss(item.id)}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {viewAll && visible.length > shown.length ? (
        <div className="attention-footer">{viewAll}</div>
      ) : null}
    </section>
  );
}

/* Work in progress (inline) ---------------------------------------------- */

/** Small marker for navigation items or actions that are not yet available. */
export function WipBadge({ children = 'In progress' }: { children?: ReactNode }) {
  return <span className="wip-badge">{children}</span>;
}

/**
 * Region-level placeholder for a visible-but-unfinished section. Keeps the
 * product structure intact; never looks like an error or a dead end.
 */
export function WorkInProgressPanel({
  feature,
  message = 'This area is still being completed. It will appear here when it is ready.',
  action,
}: {
  feature: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="wip-panel" role="status">
      <span className="wip-mark" aria-hidden="true">
        <Icon name="clock" size="md" />
      </span>
      <h3>{feature} is in progress</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}
