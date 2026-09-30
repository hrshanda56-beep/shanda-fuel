/**
 * Per-device Product Shell layout preferences: the collapsed (icon rail)
 * desktop sidebar and which navigation groups are closed.
 *
 * Presentation only, like the theme preference: stored in localStorage,
 * never sent to the server. The sidebar state is mirrored to
 * `<html data-sidebar="collapsed">` by an inline script before first paint,
 * so a collapsed rail never flashes open on load. CSS reads that attribute.
 */

export const SIDEBAR_STORAGE_KEY = 'shanda-fuel:sidebar';
export const NAV_GROUPS_STORAGE_KEY = 'shanda-fuel:nav-closed';
export const SIDEBAR_ATTRIBUTE = 'data-sidebar';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>;

export function readSidebarCollapsed(storage?: ReadableStorage): boolean {
  try {
    return (storage ?? window.localStorage).getItem(SIDEBAR_STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

/** Closed group keys, stored space-separated. Unknown keys are harmless. */
export function readClosedGroupsRaw(storage?: ReadableStorage): string {
  try {
    return (storage ?? window.localStorage).getItem(NAV_GROUPS_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function parseClosedGroups(raw: string): ReadonlySet<string> {
  return new Set(raw.split(/\s+/).filter((key) => /^[a-z-]+$/.test(key)));
}

export function toggleClosedGroup(raw: string, key: string): string {
  const closed = new Set(parseClosedGroups(raw));
  if (closed.has(key)) closed.delete(key);
  else closed.add(key);
  return [...closed].sort().join(' ');
}

function write(key: string, value: string, storage?: WritableStorage) {
  try {
    const target = storage ?? window.localStorage;
    if (value) target.setItem(key, value);
    else target.removeItem(key);
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

/* Subscription (for useSyncExternalStore) ------------------------------- */

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeShellPreferences(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_STORAGE_KEY) applySidebarAttribute(readSidebarCollapsed());
    if (event.key === SIDEBAR_STORAGE_KEY || event.key === NAV_GROUPS_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function applySidebarAttribute(
  collapsed: boolean,
  root: Pick<HTMLElement, 'setAttribute' | 'removeAttribute'> = document.documentElement,
) {
  if (collapsed) root.setAttribute(SIDEBAR_ATTRIBUTE, 'collapsed');
  else root.removeAttribute(SIDEBAR_ATTRIBUTE);
}

export function setSidebarCollapsed(collapsed: boolean) {
  applySidebarAttribute(collapsed);
  write(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : '');
  notify();
}

export function setClosedGroupsRaw(raw: string) {
  write(NAV_GROUPS_STORAGE_KEY, raw);
  notify();
}

/**
 * Runs before first paint alongside the theme script. Tiny and
 * dependency-free: it reads one key and sets one attribute.
 */
export const shellInitScript = `(function(){try{if(localStorage.getItem(${JSON.stringify(
  SIDEBAR_STORAGE_KEY,
)})==='collapsed')document.documentElement.setAttribute(${JSON.stringify(
  SIDEBAR_ATTRIBUTE,
)},'collapsed');}catch(e){}})();`;
