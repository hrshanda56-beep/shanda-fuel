'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

const KEY = 'shanda-fuel:attention-opened';
const CHANGED = 'shanda-fuel:attention-opened-changed';

type Row = Readonly<{ id: string; title: string }>;

/** A row whose wording changes (a new amount, say) counts as new again. */
const keyOf = (row: Row) => `${row.id}|${row.title}`;

function subscribe(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener(CHANGED, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(CHANGED, notify);
  };
}

function read(): string {
  try {
    return window.localStorage.getItem(KEY) ?? '[]';
  } catch {
    return '[]';
  }
}

/**
 * Which list rows this person has opened. Kept in this browser only, so it is a
 * convenience, not a record: another device starts fresh. `isUnread` is false until
 * the saved list is known, so nothing flashes as new on first paint.
 */
export function useOpenedRows() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const opened = useMemo(() => {
    if (raw === null) return null;
    try {
      const saved: unknown = JSON.parse(raw);
      return new Set(Array.isArray(saved) ? saved.filter((v) => typeof v === 'string') : []);
    } catch {
      return new Set<string>();
    }
  }, [raw]);

  const isUnread = useCallback((row: Row) => opened !== null && !opened.has(keyOf(row)), [opened]);

  const markOpened = useCallback(
    (row: Row, rows: readonly Row[]) => {
      // Keep only rows still listed, so the saved list cannot grow without end.
      const live = new Set(rows.map(keyOf));
      const kept = [...(opened ?? []), keyOf(row)].filter((key) => live.has(key));
      try {
        window.localStorage.setItem(KEY, JSON.stringify(kept));
      } catch {
        return; // Storage is optional; the marker simply resets next visit.
      }
      window.dispatchEvent(new Event(CHANGED));
    },
    [opened],
  );

  return { isUnread, markOpened };
}
