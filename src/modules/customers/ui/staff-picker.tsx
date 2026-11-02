'use client';

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { filterStaffOptions, type StaffPickerOption } from '../staff-picker-options';
import styles from './staff-benefit.module.css';

/**
 * Search-and-pick list of staff. A staff member is only ever chosen here, never typed in: the
 * list comes from Settings > Staff, so a benefit always points at one real staff record.
 */
export function StaffPicker({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: readonly StaffPickerOption[];
  value: string;
  onChange: (membershipId: string) => void;
}) {
  const listId = useId();
  const selected = options.find((option) => option.membershipId === value) ?? null;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => filterStaffOptions(options, query), [options, query]);
  const activeOption = matches[Math.min(active, matches.length - 1)];

  function choose(option: StaffPickerOption) {
    onChange(option.membershipId);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open && activeOption) {
      event.preventDefault();
      choose(activeOption);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div className={styles.picker}>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && activeOption ? `${listId}-${activeOption.membershipId}` : undefined
        }
        autoComplete="off"
        placeholder={options.length === 0 ? 'No staff to add' : 'Search staff by name'}
        disabled={options.length === 0}
        value={open ? query : (selected?.name ?? '')}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setQuery('');
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
          if (value) onChange('');
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul id={listId} role="listbox" className="dropdown-panel" aria-label="Staff">
          {matches.length === 0 ? (
            <li className="station-option-empty" role="presentation">
              No staff match “{query}”. Add people in Settings &gt; Staff first.
            </li>
          ) : (
            matches.map((option, index) => (
              <li
                key={option.membershipId}
                id={`${listId}-${option.membershipId}`}
                role="option"
                aria-selected={option.membershipId === value}
                className="dropdown-option"
                data-active={index === Math.min(active, matches.length - 1) || undefined}
                // mousedown, not click: the input's blur would otherwise close the list first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
              >
                <span>{option.name}</span>
                <span className="station-option-code">{option.email}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
