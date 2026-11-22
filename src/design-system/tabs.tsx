'use client';

import Link from 'next/link';
import { useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';

import { Icon, type IconName } from './icons';
import { nextTabIndex } from './tabs-keys';

/**
 * The one tab style: a light rounded track with the open tab as a raised pill. Every tab always
 * shows its name; an icon is optional and only where it helps recognition. The track sits at the
 * right end of its row (beside the page or card title) and scrolls inside itself instead of making
 * the page scroll sideways.
 *
 * Three shapes share the look:
 * - `TabSwitcher`: switches between views of the same page (`role="tablist"`, arrow keys).
 * - `TabLinks`: the same look where each tab is its own address.
 * - `FilterPills`: narrows one list (`aria-pressed`); it is a filter, not a set of views.
 */

export type TabItem<V extends string = string> = {
  value: V;
  label: string;
  icon?: IconName;
  /** A small number shown after the name, such as how many items the tab holds. */
  count?: number | string;
  /** `null` gives this tab no id (when it repeats another tab's value). */
  id?: string | null;
  /** Overrides whether this tab shows as open (a tab that stands for several values). */
  selected?: boolean;
  /** For the tab that owns a panel: the panel's id. */
  controls?: string;
  /** Extra class for this tab only (layout rules a screen needs for its own bar). */
  className?: string;
};

type TrackProps = Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'role' | 'aria-label'> & {
  /** What the switcher is for, read out by screen readers ("Profit views"). */
  label: string;
};

const joinClass = (...parts: Array<string | undefined | false>) => parts.filter(Boolean).join(' ');

function TabContent({ item }: { item: Pick<TabItem, 'label' | 'icon' | 'count'> }): ReactNode {
  return (
    <>
      {item.icon ? <Icon name={item.icon} size="sm" /> : null}
      <span className="ds-tab-label">{item.label}</span>
      {item.count !== undefined ? <span className="ds-tab-count">{item.count}</span> : null}
    </>
  );
}

export function TabSwitcher<V extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  className,
  ...rest
}: TrackProps & {
  tabs: readonly TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Gives each tab the id `${idPrefix}-${value}` so a panel can name it with `aria-labelledby`. */
  idPrefix?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const isOpen = (tab: TabItem<V>) => tab.selected ?? tab.value === value;
  const selected = Math.max(0, tabs.findIndex(isOpen));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Move from the tab that has focus (it may be one that stands for several values).
    const focused = refs.current.findIndex((node) => node === document.activeElement);
    const from = focused >= 0 ? focused : selected;
    const next = nextTabIndex(
      event.key,
      from,
      tabs.length,
      (index) => (refs.current[index]?.getClientRects().length ?? 0) > 0,
    );
    if (next === null || next === from) return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      {...rest}
      className={joinClass('ds-tabs', className)}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab, index) => (
        <button
          key={`${tab.value}:${index}`}
          ref={(node) => {
            refs.current[index] = node;
          }}
          id={idPrefix && tab.id !== null ? (tab.id ?? `${idPrefix}-${tab.value}`) : undefined}
          type="button"
          role="tab"
          className={tab.className}
          aria-selected={isOpen(tab)}
          aria-controls={tab.controls}
          tabIndex={isOpen(tab) ? 0 : -1}
          onClick={() => onChange(tab.value)}
        >
          <TabContent item={tab} />
        </button>
      ))}
    </div>
  );
}

export type TabLinkItem = {
  key: string;
  href: string;
  label: string;
  icon?: IconName;
  current: boolean;
};

/** The same look when each tab is a page of its own (related reports). */
export function TabLinks({
  tabs,
  label,
  className,
}: {
  tabs: readonly TabLinkItem[];
  label: string;
  className?: string;
}) {
  return (
    <nav className={joinClass('ds-tabs', className)} aria-label={label}>
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={tab.current ? 'page' : undefined}>
          <TabContent item={tab} />
        </Link>
      ))}
    </nav>
  );
}

/** The same look for narrowing one list. It stays a filter: nothing here is a view of its own. */
export function FilterPills<V extends string>({
  options,
  value,
  onChange,
  label,
  className,
  ...rest
}: TrackProps & {
  options: readonly TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
}) {
  return (
    <div {...rest} className={joinClass('ds-tabs', className)} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.className}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <TabContent item={option} />
        </button>
      ))}
    </div>
  );
}
