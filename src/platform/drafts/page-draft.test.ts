import { describe, expect, it } from 'vitest';
import { DRAFT_MAX_AGE_MS, purgeExpiredDrafts } from './local-draft';
import { hasOwnDraft, restorableSteps, snapshotChanges, type FieldDescription } from './page-draft';

function field(over: Partial<FieldDescription> = {}): FieldDescription {
  return {
    tag: 'input',
    type: 'text',
    name: '',
    id: '',
    label: '',
    placeholder: '',
    autocomplete: '',
    value: '',
    defaultValue: '',
    checked: false,
    defaultChecked: false,
    optedOut: false,
    disabled: false,
    ...over,
  };
}

describe('page drafts', () => {
  it('keeps only fields the person changed', () => {
    const fields = [
      field({ name: 'amount', value: '120' }),
      field({ name: 'note', value: 'same', defaultValue: 'same' }),
    ];
    expect(Object.values(snapshotChanges(fields))).toEqual(['120']);
  });

  it('never keeps passwords, codes, files or opted-out areas', () => {
    const fields = [
      field({ type: 'password', value: 'x' }),
      field({ autocomplete: 'one-time-code', value: '123456' }),
      field({ type: 'file', value: 'a.pdf' }),
      field({ name: 'own', value: 'v', optedOut: true }),
    ];
    expect(snapshotChanges(fields)).toEqual({});
  });

  it('tells apart rows that share a name', () => {
    const fields = [field({ name: 'qty', value: '1' }), field({ name: 'qty', value: '2' })];
    expect(Object.values(snapshotChanges(fields))).toEqual(['1', '2']);
  });

  it('can leave out the form that was just saved', () => {
    const fields = [field({ name: 'a', value: '1' }), field({ name: 'b', value: '2' })];
    expect(Object.values(snapshotChanges(fields, (i) => i === 0))).toEqual(['2']);
  });

  it('offers back only what would change the page', () => {
    const fields = [field({ name: 'amount' }), field({ name: 'note', value: 'hi' })];
    const saved = { 'input|text|amount~0': '120', 'input|text|note~0': 'hi' };
    expect(restorableSteps(fields, saved)).toEqual([{ index: 0, value: '120' }]);
  });

  it('remembers checkboxes and the chosen radio', () => {
    const fields = [
      field({ type: 'checkbox', name: 'paid', checked: true }),
      field({ type: 'radio', name: 'm', value: 'cash', checked: false }),
      field({ type: 'radio', name: 'm', value: 'bank', checked: true }),
    ];
    expect(Object.keys(snapshotChanges(fields))).toEqual([
      'input|checkbox|paid~0',
      'input|radio|m|bank~0',
    ]);
  });

  it('purges drafts past 24 hours for everyone on the device', () => {
    const NOW = 1_800_000_000_000;
    const map = new Map<string, string>([
      ['shanda-fuel:draft:old', JSON.stringify({ savedAt: NOW - DRAFT_MAX_AGE_MS - 1 })],
      ['shanda-fuel:draft:new', JSON.stringify({ savedAt: NOW - 1000 })],
      ['other', 'keep'],
    ]);
    const storage = {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    purgeExpiredDrafts(NOW, storage);
    expect([...map.keys()].sort()).toEqual(['other', 'shanda-fuel:draft:new']);
  });

  it('leaves screens with their own drafts alone', () => {
    expect(hasOwnDraft('/inventory/deliveries')).toBe(true);
    expect(hasOwnDraft('/operations/reconciliations/abc')).toBe(true);
    expect(hasOwnDraft('/expenses')).toBe(false);
  });
});
