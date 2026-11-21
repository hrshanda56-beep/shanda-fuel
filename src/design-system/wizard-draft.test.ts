import { describe, expect, it } from 'vitest';

import { DRAFT_MAX_AGE_MS } from '@/platform/drafts/local-draft';

import {
  isBlank,
  keepableAnswers,
  loadWizardDraft,
  saveWizardDraft,
  wizardDraftKey,
} from './wizard-draft';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    size: () => map.size,
  };
}

const STEPS = ['what', 'money', 'review'];
const KEY = wizardDraftKey(['expense', 'user_1', 'station_1']);
const NOW = 1_800_000_000_000;

describe('wizard drafts', () => {
  it('keys one wizard per person and place', () => {
    expect(wizardDraftKey(['expense', 'user_1', 'a'])).not.toBe(
      wizardDraftKey(['expense', 'user_2', 'a']),
    );
    expect(wizardDraftKey(['expense', 'user_1', 'a'])).not.toBe(
      wizardDraftKey(['regular', 'user_1', 'a']),
    );
  });

  it('keeps answers from screens that are no longer showing', () => {
    const storage = memoryStorage();
    saveWizardDraft(
      KEY,
      'v1',
      { step: 'money', index: 0, answers: { what: 'Repairs', amount: '25.00' } },
      NOW,
      storage,
    );
    const loaded = loadWizardDraft<{ what: string; amount: string }>(
      KEY,
      'v1',
      STEPS,
      NOW + 1000,
      storage,
    );
    expect(loaded?.data).toEqual({
      step: 'money',
      index: 0,
      answers: { what: 'Repairs', amount: '25.00' },
    });
  });

  it('removes the draft when every answer is empty again', () => {
    const storage = memoryStorage();
    saveWizardDraft(KEY, 'v1', { step: 'what', index: 0, answers: { what: 'x' } }, NOW, storage);
    expect(storage.size()).toBe(1);
    saveWizardDraft(KEY, 'v1', { step: 'what', index: 0, answers: { what: '' } }, NOW, storage);
    expect(storage.size()).toBe(0);
  });

  it('never keeps secrets, whatever the screen calls them', () => {
    expect(
      keepableAnswers({ amount: '1', password: 'x', oneTimeCode: '1', cardNumber: '4' }),
    ).toEqual({ amount: '1' });
  });

  it('throws away a draft typed on a different version of the record', () => {
    const storage = memoryStorage();
    saveWizardDraft(KEY, 'v1', { step: 'money', index: 0, answers: { a: '1' } }, NOW, storage);
    expect(loadWizardDraft(KEY, 'v2', STEPS, NOW, storage)).toBeNull();
    expect(storage.size()).toBe(0);
  });

  it('throws away a draft older than a day', () => {
    const storage = memoryStorage();
    saveWizardDraft(KEY, 'v1', { step: 'money', index: 0, answers: { a: '1' } }, NOW, storage);
    expect(loadWizardDraft(KEY, 'v1', STEPS, NOW + DRAFT_MAX_AGE_MS + 1, storage)).toBeNull();
  });

  it('does not restore to a screen that no longer exists', () => {
    const storage = memoryStorage();
    saveWizardDraft(KEY, 'v1', { step: 'gone', index: 0, answers: { a: '1' } }, NOW, storage);
    expect(loadWizardDraft(KEY, 'v1', STEPS, NOW, storage)).toBeNull();
    expect(storage.size()).toBe(0);
  });

  it('treats empty values as blank', () => {
    expect(isBlank({ a: '', b: false, c: [], d: null })).toBe(true);
    expect(isBlank({ a: '', b: '0' })).toBe(false);
  });
});
