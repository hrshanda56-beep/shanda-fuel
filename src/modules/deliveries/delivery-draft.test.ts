import { describe, expect, it } from 'vitest';
import {
  clearDraft,
  draftStorageKey,
  loadDraft,
  saveDraft,
} from '../../platform/drafts/local-draft';

const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
};

describe('delivery form draft', () => {
  it('is kept per station and offered back with what was typed', () => {
    const storage = memory();
    const keyA = draftStorageKey(['delivery', 'tenant', 'station-a']);
    const keyB = draftStorageKey(['delivery', 'tenant', 'station-b']);
    saveDraft(keyA, 'new', { deliveryNote: 'DN-1', noteLitres: '10000' }, 1000, storage);
    expect(loadDraft(keyA, 'new', 2000, storage)?.data).toEqual({
      deliveryNote: 'DN-1',
      noteLitres: '10000',
    });
    expect(loadDraft(keyB, 'new', 2000, storage)).toBeNull();
  });

  it('is gone once cleared after the delivery is recorded', () => {
    const storage = memory();
    const key = draftStorageKey(['delivery', 'tenant', 'station-a']);
    saveDraft(key, 'new', { deliveryNote: 'DN-1' }, 1000, storage);
    clearDraft(key, storage);
    expect(loadDraft(key, 'new', 2000, storage)).toBeNull();
  });
});
