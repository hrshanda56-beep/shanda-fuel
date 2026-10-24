/**
 * Unsent form input kept on this device (stage 1 of offline drafts). A draft is only a copy of what
 * someone typed: it is never sent anywhere, never counts as saved, and is thrown away when it goes
 * stale. Storage can be missing, full or blocked (private windows, kiosks), so every call is
 * guarded and a failure just means "no draft".
 */

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>;

/** A draft older than this is discarded rather than offered back. */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const PREFIX = 'shanda-fuel:draft:';

export type StoredDraft<T> = Readonly<{
  /** Version of the saved record the draft was typed on top of; a different one means it is stale. */
  baseVersion: string;
  savedAt: number;
  data: T;
}>;

export function draftStorageKey(parts: readonly (string | undefined | null)[]): string {
  return PREFIX + parts.map((part) => encodeURIComponent(part ?? '-')).join(':');
}

function browserStorage(): (ReadableStorage & WritableStorage) | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function saveDraft<T>(
  key: string,
  baseVersion: string,
  data: T,
  now: number = Date.now(),
  storage: WritableStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const draft: StoredDraft<T> = { baseVersion, savedAt: now, data };
    storage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/**
 * The draft for a key, or null when there is none, it is too old, it was typed on a different
 * version of the record, or it cannot be read. Stale drafts are removed on the way.
 */
export function loadDraft<T>(
  key: string,
  baseVersion: string,
  now: number = Date.now(),
  storage: (ReadableStorage & WritableStorage) | null = browserStorage(),
): StoredDraft<T> | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft<T>> | null;
    const valid =
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof parsed.baseVersion === 'string' &&
      typeof parsed.savedAt === 'number' &&
      'data' in parsed;
    if (
      !valid ||
      parsed.baseVersion !== baseVersion ||
      now - parsed.savedAt > DRAFT_MAX_AGE_MS ||
      parsed.savedAt > now + 60_000
    ) {
      storage.removeItem(key);
      return null;
    }
    return parsed as StoredDraft<T>;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* nothing more to do */
    }
    return null;
  }
}

export function clearDraft(key: string, storage: WritableStorage | null = browserStorage()): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}
