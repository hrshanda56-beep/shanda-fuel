import { describe, expect, it } from 'vitest';

import {
  applySidebarAttribute,
  NAV_GROUPS_STORAGE_KEY,
  parseClosedGroups,
  readClosedGroupsRaw,
  readSidebarCollapsed,
  shellInitScript,
  SIDEBAR_ATTRIBUTE,
  SIDEBAR_STORAGE_KEY,
  toggleClosedGroup,
} from './shell-preferences';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null };
}

describe('shell layout preferences', () => {
  it('defaults to an expanded sidebar with every group open', () => {
    expect(readSidebarCollapsed(memoryStorage())).toBe(false);
    expect(parseClosedGroups(readClosedGroupsRaw(memoryStorage())).size).toBe(0);
  });

  it('reads a stored collapsed sidebar and closed groups', () => {
    const storage = memoryStorage({
      [SIDEBAR_STORAGE_KEY]: 'collapsed',
      [NAV_GROUPS_STORAGE_KEY]: 'finance operations',
    });
    expect(readSidebarCollapsed(storage)).toBe(true);
    expect([...parseClosedGroups(readClosedGroupsRaw(storage))]).toEqual(['finance', 'operations']);
  });

  it('fails safe when storage is unavailable', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSidebarCollapsed(blocked)).toBe(false);
    expect(readClosedGroupsRaw(blocked)).toBe('');
  });

  it('toggles a group and ignores malformed stored values', () => {
    expect(toggleClosedGroup('', 'finance')).toBe('finance');
    expect(toggleClosedGroup('finance operations', 'finance')).toBe('operations');
    expect([...parseClosedGroups('Finance <script> operations')]).toEqual(['operations']);
  });

  it('mirrors the sidebar state to the root attribute', () => {
    const attributes = new Map<string, string>();
    const root = {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    };
    applySidebarAttribute(true, root);
    expect(attributes.get(SIDEBAR_ATTRIBUTE)).toBe('collapsed');
    applySidebarAttribute(false, root);
    expect(attributes.has(SIDEBAR_ATTRIBUTE)).toBe(false);
  });

  it('ships a small, self-contained pre-paint script', () => {
    expect(shellInitScript).toContain(SIDEBAR_STORAGE_KEY);
    expect(shellInitScript).toContain('try{');
    expect(shellInitScript.length).toBeLessThan(300);
  });
});
