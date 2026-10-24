import { describe, expect, it } from 'vitest';
import { DRAFT_MAX_AGE_MS, clearDraft, draftStorageKey, loadDraft, saveDraft } from './local-draft';

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const NOW = 1_800_000_000_000;

describe('local drafts', () => {
  it('keeps what was typed and gives it back for the same record version', () => {
    const storage = memoryStorage();
    expect(saveDraft('k', 'v3', { cash: '120.50' }, NOW, storage)).toBe(true);
    expect(loadDraft('k', 'v3', NOW + 1000, storage)).toEqual({
      baseVersion: 'v3',
      savedAt: NOW,
      data: { cash: '120.50' },
    });
  });

  it('drops a draft typed on an older version of the record', () => {
    const storage = memoryStorage();
    saveDraft('k', 'v3', { cash: '1' }, NOW, storage);
    expect(loadDraft('k', 'v4', NOW, storage)).toBeNull();
    expect(storage.map.has('k')).toBe(false);
  });

  it('drops a draft that is more than a day old', () => {
    const storage = memoryStorage();
    saveDraft('k', 'v1', {}, NOW, storage);
    expect(loadDraft('k', 'v1', NOW + DRAFT_MAX_AGE_MS, storage)).not.toBeNull();
    expect(loadDraft('k', 'v1', NOW + DRAFT_MAX_AGE_MS + 1, storage)).toBeNull();
    expect(storage.map.has('k')).toBe(false);
  });

  it('ignores corrupt or oddly shaped values', () => {
    for (const bad of ['not json', 'null', '{"data":1}', '"text"', '{"baseVersion":1}']) {
      const storage = memoryStorage({ k: bad });
      expect(loadDraft('k', 'v1', NOW, storage)).toBeNull();
      expect(storage.map.has('k')).toBe(false);
    }
  });

  it('treats a clock set in the future as untrustworthy', () => {
    const storage = memoryStorage();
    saveDraft('k', 'v1', {}, NOW + 3_600_000, storage);
    expect(loadDraft('k', 'v1', NOW, storage)).toBeNull();
  });

  it('clears a draft once it has been saved properly', () => {
    const storage = memoryStorage();
    saveDraft('k', 'v1', {}, NOW, storage);
    clearDraft('k', storage);
    expect(loadDraft('k', 'v1', NOW, storage)).toBeNull();
  });

  it('never throws when storage is missing, full or blocked', () => {
    expect(saveDraft('k', 'v1', {}, NOW, null)).toBe(false);
    expect(loadDraft('k', 'v1', NOW, null)).toBeNull();
    const full = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(saveDraft('k', 'v1', {}, NOW, full)).toBe(false);
    expect(loadDraft('k', 'v1', NOW, full)).toBeNull();
    expect(() => clearDraft('k', full)).not.toThrow();
  });

  it('builds a key that cannot collide across scopes', () => {
    expect(draftStorageKey(['a:b', 'c'])).not.toBe(draftStorageKey(['a', 'b:c']));
    expect(draftStorageKey(['t', undefined])).toBe('shanda-fuel:draft:t:-');
  });
});
