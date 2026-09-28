/**
 * Theme preference model.
 *
 * - `system` (default): no `data-theme` attribute; CSS follows
 *   `prefers-color-scheme`.
 * - `light` / `dark`: explicit override via `<html data-theme="…">`.
 *
 * The preference is a per-device presentation choice, stored in
 * localStorage. It is never sent to the server and carries no authority.
 */

export const themePreferences = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof themePreferences)[number];
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export const THEME_STORAGE_KEY = 'shanda-fuel:theme';
export const THEME_ATTRIBUTE = 'data-theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (themePreferences as readonly string[]).includes(value);
}

export function readStoredThemePreference(storage?: Pick<Storage, 'getItem'>): ThemePreference {
  try {
    const value = (storage ?? window.localStorage).getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function storeThemePreference(
  preference: ThemePreference,
  storage?: Pick<Storage, 'setItem' | 'removeItem'>,
) {
  try {
    const target = storage ?? window.localStorage;
    if (preference === 'system') target.removeItem(THEME_STORAGE_KEY);
    else target.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode, policy). The preference then
    // lasts for the current page only, which is acceptable for presentation.
  }
}

export function applyThemePreference(
  preference: ThemePreference,
  root: Pick<HTMLElement, 'setAttribute' | 'removeAttribute'> = document.documentElement,
) {
  if (preference === 'system') root.removeAttribute(THEME_ATTRIBUTE);
  else root.setAttribute(THEME_ATTRIBUTE, preference);
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean) {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/**
 * Runs before first paint so an explicit override never flashes the system
 * theme. Kept tiny and dependency-free; it only reads localStorage and sets
 * one attribute. If a Content Security Policy is introduced, this inline
 * script needs a nonce or hash (see design-system README).
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==='light'||t==='dark')document.documentElement.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},t);}catch(e){}})();`;
