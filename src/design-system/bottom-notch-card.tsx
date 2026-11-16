import type { CSSProperties, ReactNode } from 'react';

/**
 * A card that gives up its bottom-right corner to its buttons, so they sit in the gap, outside the
 * card, the way Back and Next do on the shift screens. The cut and its sizes live in globals.css
 * (`.notch-wrap`). Use it only where the buttons are the card's last row: with no `actions` it is a
 * plain card, and on narrow screens the buttons follow below the whole card.
 *
 * `overlay` is for anything that is positioned over the card itself, such as a corner menu.
 * `notchWidth` is the gap's width in rem and defaults from the number of buttons.
 */
export function BottomNotchCard({
  actions,
  actionCount = 2,
  notchWidth,
  overlay,
  className = '',
  surfaceClassName = '',
  children,
  ...rest
}: {
  actions?: ReactNode;
  actionCount?: 1 | 2;
  notchWidth?: number;
  overlay?: ReactNode;
  className?: string;
  surfaceClassName?: string;
  children: ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <div
      className={`notch-wrap ${className}`.trim()}
      data-notched={actions ? '' : undefined}
      data-actions={actionCount}
      style={notchWidth ? ({ '--notch-w': `${notchWidth}rem` } as CSSProperties) : undefined}
      {...rest}
    >
      <div className={`notch-surface ${surfaceClassName}`.trim()}>{children}</div>
      {overlay}
      {actions ? <div className="notch-actions">{actions}</div> : null}
    </div>
  );
}
