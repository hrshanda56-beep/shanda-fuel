'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  applyThemePreference,
  readStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from './theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const THEME_CHANGE_EVENT = 'shanda-fuel:theme-change';

function subscribeToSystemTheme(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function subscribeToStoredTheme(onChange: () => void) {
  const sync = () => {
    const next = readStoredThemePreference();
    applyThemePreference(next);
    onChange();
  };
  window.addEventListener('storage', sync);
  window.addEventListener(THEME_CHANGE_EVENT, sync);
  return () => {
    window.removeEventListener('storage', sync);
    window.removeEventListener(THEME_CHANGE_EVENT, sync);
  };
}

/**
 * Theme preference for the product shell's theme control. Defaults to
 * `system`; an explicit choice persists per device and syncs across tabs.
 */
export function useThemePreference(): {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
} {
  const preference = useSyncExternalStore(
    subscribeToStoredTheme,
    readStoredThemePreference,
    () => 'system' as ThemePreference,
  );
  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );

  useEffect(() => applyThemePreference(preference), [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    applyThemePreference(next);
    storeThemePreference(next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  return {
    preference,
    resolvedTheme: resolveTheme(preference, systemPrefersDark),
    setPreference,
  };
}
