import { describe, expect, it } from 'vitest';

import {
  applyThemePreference,
  isThemePreference,
  readStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  THEME_STORAGE_KEY,
  themeInitScript,
} from './theme';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

function fakeRoot() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
  };
}

describe('theme preference', () => {
  it('defaults to system when nothing valid is stored', () => {
    expect(readStoredThemePreference(memoryStorage())).toBe('system');
    expect(readStoredThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: 'sepia' }))).toBe(
      'system',
    );
  });

  it('falls back to system when storage throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredThemePreference(throwing)).toBe('system');
  });

  it('stores explicit overrides and clears storage for system', () => {
    const storage = memoryStorage();
    storeThemePreference('dark', storage);
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe('dark');
    storeThemePreference('system', storage);
    expect(storage.values.has(THEME_STORAGE_KEY)).toBe(false);
  });

  it('sets data-theme only for explicit overrides', () => {
    const root = fakeRoot();
    applyThemePreference('light', root);
    expect(root.attributes.get('data-theme')).toBe('light');
    applyThemePreference('system', root);
    expect(root.attributes.has('data-theme')).toBe(false);
  });

  it('resolves system against the device preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('validates preference values', () => {
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('auto')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it('init script only honours known overrides and never throws', () => {
    expect(themeInitScript).toContain(THEME_STORAGE_KEY);
    expect(themeInitScript).toContain("t==='light'||t==='dark'");
    expect(themeInitScript).toMatch(/try\{.*\}catch\(e\)\{\}/);
  });
});
