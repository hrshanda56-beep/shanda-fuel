'use client';

import Link from 'next/link';
import { Children, useState, type ReactNode } from 'react';

import { Icon, type IconName } from './icons';
import { Modal } from './modal';
import { IconButton, Skeleton } from './primitives';

/**
 * Page building blocks extracted from the Today screen. They reuse the
 * dashboard's own class names, so a page assembled from them looks the same
 * as the dashboard at every width. Presentation only: nothing here fetches,
 * calculates or decides.
 */

export type KpiState = 'ready' | 'loading' | 'pending' | 'forbidden' | 'error' | 'choose' | 'empty';

const KPI_CAPTION: Partial<Record<KpiState, string>> = {
  forbidden: 'No access',
  error: 'Unavailable',
  choose: 'Choose a station',
  pending: 'Not connected yet',
  empty: 'No data yet',
};

/** The tinted figure tiles. Tints follow tile order, exactly as on Today. */
export function KpiGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <dl className="today-figures" aria-label={label} data-count={Children.count(children)}>
      {children}
    </dl>
  );
}

/**
 * One headline number. `value` is a display string from the formatters; pass
 * `null` (with a `state`) when there is nothing to show, and the tile shows a
 * dash and a plain caption instead of a misleading zero.
 */
export function KpiTile({
  label,
  value,
  href,
  onSelect,
  icon,
  state = 'ready',
  caption,
}: {
  label: string;
  value: ReactNode | null;
  href?: string;
  /** Makes the whole tile a button (e.g. to switch a tab) when there is no page to link to. */
  onSelect?: () => void;
  icon?: IconName;
  state?: KpiState;
  /** Replaces the default caption for a tile with no value, or adds context to one with a value. */
  caption?: string;
}) {
  const hasValue = value !== null && value !== undefined && state === 'ready';
  return (
    <div className="today-figure" data-state={hasValue ? 'ready' : state}>
      <span className="today-figure-icon" aria-hidden="true">
        {icon ? <Icon name={icon} /> : null}
      </span>
      <span className="today-figure-line" aria-hidden="true" />
      <dt>
        {href ? (
          <Link className="today-figure-link" href={href}>
            {label}
          </Link>
        ) : onSelect ? (
          <button type="button" className="today-figure-link" onClick={onSelect}>
            {label}
          </button>
        ) : (
          label
        )}
      </dt>
      <dd>
        {state === 'loading' ? (
          <Skeleton lines={1} label={`Loading ${label.toLowerCase()}`} />
        ) : hasValue ? (
          <>
            <span
              className="today-figure-value"
              data-long={typeof value === 'string' && value.length > 8 ? '' : undefined}
            >
              {value}
            </span>
            {caption ? <span className="today-figure-caption">{caption}</span> : null}
          </>
        ) : (
          <>
            <span className="today-figure-value" aria-hidden="true">
              —
            </span>
            <span className="today-figure-caption">
              {caption ?? KPI_CAPTION[state] ?? KPI_CAPTION.empty}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * The one centred status card: a ringed icon, a title, a detail line, a
 * status and a single next action. With `href` the whole card is the link
 * (as on Today); with `action` the card holds its own button instead.
 */
export function HeroStatusCard({
  icon = 'fuel',
  title,
  detail,
  status,
  href,
  action,
}: {
  icon?: IconName;
  title: string;
  detail?: ReactNode;
  status?: ReactNode;
  href?: string;
  action?: ReactNode;
}) {
  const body = (
    <>
      <span className="today-hero-ring" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span className="today-hero-title">{title}</span>
      {detail ? <span className="today-hero-detail">{detail}</span> : null}
      {status || href ? (
        <span className="today-hero-status">
          {status}
          {href ? (
            <span className="today-hero-go" aria-hidden="true">
              <Icon name="arrow-right" />
            </span>
          ) : null}
        </span>
      ) : null}
      {action ? <span className="hero-action">{action}</span> : null}
    </>
  );
  return href ? (
    <Link className="today-hero" href={href}>
      {body}
    </Link>
  ) : (
    <div className="today-hero today-hero-static">{body}</div>
  );
}

export type SegmentedOption<T extends string> = { value: T; label: string };

/**
 * Pill choices as on the Today period control. Options wrap onto a second row
 * on narrow screens, so the control never scrolls sideways.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  fit = 'equal',
}: {
  options: ReadonlyArray<SegmentedOption<T> | T>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  /** `equal` shares the width (short labels); `content` sizes each pill to its label and wraps. */
  fit?: 'equal' | 'content';
}) {
  return (
    <div
      className={`today-periods segmented${fit === 'content' ? ' segmented-content' : ''}`}
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const item = typeof option === 'string' ? { value: option, label: option } : option;
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            className="today-period"
            aria-pressed={active}
            data-active={active || undefined}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small round refresh button for a section header; never a full-width button. */
export function RefreshButton({
  onClick,
  disabled,
  label = 'Refresh',
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <IconButton label={label} icon="refresh" size="sm" onClick={onClick} disabled={disabled} />
  );
}

/**
 * Create/record actions live in a sheet: a bottom sheet on phones, a centred
 * dialog on larger screens. The trigger and the body are render props so the
 * body can close the sheet after a successful command.
 */
export function ActionSheet({
  title,
  description,
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  dismissible,
  size,
}: {
  title: string;
  description?: ReactNode;
  trigger?: (open: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  dismissible?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };
  return (
    <>
      {trigger ? trigger(() => setOpen(true)) : null}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        dismissible={dismissible}
        size={size}
      >
        {children(() => setOpen(false))}
      </Modal>
    </>
  );
}

/** Skeleton of a figure row, so loading mirrors the finished layout. */
export function SkeletonTiles({ count = 4, label }: { count?: number; label: string }) {
  return (
    <dl className="today-figures" aria-busy="true" aria-label={label} data-count={count}>
      {Array.from({ length: count }, (_, index) => (
        <div className="today-figure" data-state="loading" key={index}>
          <span className="today-figure-icon" aria-hidden="true" />
          <span className="today-figure-line" aria-hidden="true" />
          <dt>
            <span className="skeleton-line skeleton-line-2" aria-hidden="true" />
          </dt>
          <dd>
            <span className="skeleton-line skeleton-line-1" aria-hidden="true" />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Skeleton of a section card with a few rows. */
export function SkeletonCard({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <section className="section" aria-busy="true">
      <Skeleton lines={lines} label={label} />
    </section>
  );
}
