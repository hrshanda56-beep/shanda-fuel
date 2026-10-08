'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../../design-system/icons';

type Item =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'action'; label: string; onSelect: () => void };

/**
 * Overflow menu for one report row: View, Share private link, Export CSV.
 * Keyboard: Enter/Space/ArrowDown open, arrows move, Home/End jump, Escape
 * closes and returns focus to the button, Tab and an outside click close.
 */
export function ReportActionMenu({
  reportTitle,
  items,
  disabled = false,
}: {
  reportTitle: string;
  items: readonly Item[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  function focusItem(index: number) {
    const nodes = rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!nodes?.length) return;
    nodes[(index + nodes.length) % nodes.length]?.focus();
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    focusItem(0);
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    const nodes = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(-1);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className="action-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="button button-quiet action-menu-button"
        aria-label={`More actions for ${reportTitle}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="more" />
      </button>
      {open ? (
        <ul className="action-menu-list" role="menu" id={menuId} onKeyDown={onMenuKeyDown}>
          {items.map((item) => (
            <li role="none" key={item.label}>
              {item.kind === 'link' ? (
                <Link
                  role="menuitem"
                  className="action-menu-item"
                  href={item.href}
                  tabIndex={-1}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="action-menu-item"
                  tabIndex={-1}
                  onClick={() => {
                    close(true);
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
