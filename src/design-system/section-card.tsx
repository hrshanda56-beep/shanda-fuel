import type { ReactNode } from 'react';

/**
 * The calm building block of Settings-style screens: one white card per topic, a title with an
 * optional note and action on one line, then flat rows or a few fields. Styles live in
 * `styles/section-card.css`.
 */
export function SectionCard({
  id,
  title,
  note,
  action,
  children,
  className = '',
}: {
  /** Used to label the card for assistive technology. */
  id: string;
  title: ReactNode;
  /** One short sentence under the title. */
  note?: ReactNode;
  /** Buttons that sit at the end of the title line. */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const titleId = `${id}-title`;
  return (
    <section className={`sc ${className}`.trim()} aria-labelledby={titleId}>
      <header className="sc-head">
        <div className="sc-head-text">
          <h2 id={titleId} className="sc-title">
            {title}
          </h2>
          {note ? <p className="sc-note">{note}</p> : null}
        </div>
        {action ? <div className="sc-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A flat list inside a card. Each row is a name, a line of detail, and something at the end. */
export function CardRows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="sc-rows" aria-label={label}>
      {children}
    </ul>
  );
}

export function CardRow({
  title,
  badge,
  detail,
  aside,
}: {
  title: ReactNode;
  /** Sits right after the title, such as a status. */
  badge?: ReactNode;
  detail?: ReactNode;
  /** Buttons or a status at the end of the row. */
  aside?: ReactNode;
}) {
  return (
    <li className="sc-row">
      <div className="sc-row-main">
        <span className="sc-row-title">
          <span>{title}</span>
          {badge}
        </span>
        {detail ? <span className="sc-row-detail">{detail}</span> : null}
      </div>
      {aside ? <div className="sc-row-side">{aside}</div> : null}
    </li>
  );
}

/** Read-only facts as small labelled tiles, the same way the Finance cards show them. */
export function CardTiles({
  items,
}: {
  items: ReadonlyArray<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="sc-tiles">
      {items.map((item) => (
        <div key={item.label} className="sc-tile">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A quiet sentence for a card with nothing in it yet. */
export function CardEmpty({ children }: { children: ReactNode }) {
  return <p className="sc-empty">{children}</p>;
}
