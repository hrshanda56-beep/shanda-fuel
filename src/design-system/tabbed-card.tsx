'use client';

import { useId, useState, type ReactNode } from 'react';
import { Card } from './primitives';

export type CardTab = {
  id: string;
  label: string;
  /** Sits beside the title while this tab is open, such as an explanation mark. */
  aside?: ReactNode;
  content: ReactNode;
};

/**
 * One card for tables that belong together: the title on the left, the tab switcher at the top
 * right, and the open tab's content below. The other tabs stay mounted but hidden, so their state
 * (a page, an open row) is kept. With a single tab the switcher is left out.
 */
export function TabbedCard({
  title,
  tabs,
  className = '',
  defaultTab,
}: {
  title: ReactNode;
  tabs: readonly CardTab[];
  className?: string;
  defaultTab?: string;
}) {
  const base = useId();
  const [openId, setOpenId] = useState(defaultTab ?? tabs[0]?.id);
  const active = tabs.find((tab) => tab.id === openId) ?? tabs[0];
  if (!active) return null;
  const titleId = `${base}-title`;
  return (
    <Card as="section" className={`panel ${className}`.trim()} aria-labelledby={titleId}>
      <div className="panel-heading">
        <div className="heading-inline">
          <h2 id={titleId}>{title}</h2>
          {active.aside}
        </div>
        {tabs.length > 1 ? (
          <div className="profit-tabs" role="tablist" aria-label={`${String(title)} views`}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                id={`${base}-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={tab.id === active.id}
                aria-controls={`${base}-panel-${tab.id}`}
                onClick={() => setOpenId(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${base}-panel-${tab.id}`}
          role={tabs.length > 1 ? 'tabpanel' : undefined}
          aria-labelledby={tabs.length > 1 ? `${base}-tab-${tab.id}` : undefined}
          hidden={tab.id !== active.id}
        >
          {tab.content}
        </div>
      ))}
    </Card>
  );
}
