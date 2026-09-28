'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  applyThemePreference,
  readStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from './theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeToSystemTheme(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
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
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );

  useEffect(() => {
    // Read after mount so server and first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferenceState(readStoredThemePreference());
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = readStoredThemePreference();
      applyThemePreference(next);
      setPreferenceState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    applyThemePreference(next);
    storeThemePreference(next);
    setPreferenceState(next);
  }, []);

  return {
    preference,
    resolvedTheme: resolveTheme(preference, systemPrefersDark),
    setPreference,
  };
}
