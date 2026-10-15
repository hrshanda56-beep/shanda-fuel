'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';

export type DropdownOption = { value: string; label: string; disabled?: boolean };

/**
 * The system's dropdown: a button that opens a listbox. Use it wherever a single
 * choice is picked from a short list, so every picker looks and behaves the same.
 * Keyboard: Enter, Space and the arrows open; arrows, Home and End move; Enter or
 * Space picks; Escape closes and returns focus; Tab and an outside click close.
 * Label it with a `<label htmlFor={id}>` or `aria-label`.
 */
export function Dropdown({
  id,
  value,
  options,
  onValueChange,
  placeholder = 'Choose',
  disabled = false,
  align = 'start',
  triggerLabel,
  triggerIcon,
  className = '',
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: string;
  options: readonly DropdownOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Which edge of the trigger the list lines up with. */
  align?: 'start' | 'end';
  /** Shown on the trigger instead of the chosen option, e.g. a "Filters" button. */
  triggerLabel?: string;
  triggerIcon?: IconName;
  className?: string;
  'aria-label'?: string;
}) {
  const generated = useId();
  const triggerId = id ?? generated;
  const listId = `${triggerId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [active, setActive] = useState(Math.max(selectedIndex, 0));
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  function openList() {
    setActive(Math.max(selectedIndex, 0));
    setOpen(true);
  }

  function move(step: number) {
    if (options.length === 0) return;
    let next = active;
    for (let tries = 0; tries < options.length; tries += 1) {
      next = (next + step + options.length) % options.length;
      if (!options[next]?.disabled) break;
    }
    setActive(next);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (option.value !== value) onValueChange(option.value);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openList();
      else move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      setActive(options.length - 1);
    } else if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      choose(active);
    }
  }

  return (
    <div className={`dropdown ${className}`.trim()} ref={rootRef} data-open={open || undefined}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="dropdown-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${triggerId}-option-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        {triggerIcon ? <Icon name={triggerIcon} size="sm" /> : null}
        <span
          className="dropdown-value"
          data-placeholder={(!triggerLabel && !selected) || undefined}
        >
          {triggerLabel ?? selected?.label ?? placeholder}
        </span>
        <Icon name="chevron-down" size="sm" />
      </button>
      {open ? (
        <ul className="dropdown-panel" role="listbox" id={listId} data-align={align}>
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${triggerId}-option-${index}`}
              role="option"
              className="dropdown-option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-active={index === active || undefined}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value ? <Icon name="check" size="sm" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
