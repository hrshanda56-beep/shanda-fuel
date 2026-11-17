import type { CSSProperties, ReactNode } from 'react';
import { Card } from './primitives';

/**
 * A card that gives up its top-right corner to its actions, so the buttons sit in the gap, outside
 * the card, the way they do on the Profits screens. `notchWidth` is the width of the gap in rem:
 * the buttons' width plus about a rem of breathing room. Narrow cards keep a whole shape and the
 * actions follow below.
 */
export function NotchedCard({
  title,
  titleId,
  titleAside,
  actions,
  notchWidth = 0,
  className = '',
  wrapperClassName = '',
  children,
}: {
  title: ReactNode;
  titleId: string;
  /** Sits beside the title, such as an explanation mark. */
  titleAside?: ReactNode;
  /** Without actions the card is a plain one, with no gap cut out. */
  actions?: ReactNode;
  /** Needed only with actions. */
  notchWidth?: number;
  className?: string;
  /** For the box around the card, such as a grid span. */
  wrapperClassName?: string;
  children: ReactNode;
}) {
  const heading = (
    <span className="heading-with-tip">
      <h2 id={titleId} className="profit-title">
        {title}
      </h2>
      {titleAside}
    </span>
  );
  if (!actions)
    return (
      <Card
        as="section"
        className={`panel profit-panel ${className} ${wrapperClassName}`.trim()}
        aria-labelledby={titleId}
      >
        {heading}
        {children}
      </Card>
    );
  return (
    <div
      className={`profit-fuel-wrap ${wrapperClassName}`.trim()}
      data-narrow-notch={notchWidth <= 12 ? '' : undefined}
      style={{ '--notch-w': `${notchWidth}rem` } as CSSProperties}
    >
      <Card
        as="section"
        className={`panel profit-panel profit-fuel-card ${className}`.trim()}
        aria-labelledby={titleId}
      >
        {heading}
        {children}
      </Card>
      <nav className="profit-links" aria-label={`${titleId} actions`}>
        {actions}
      </nav>
    </div>
  );
}
