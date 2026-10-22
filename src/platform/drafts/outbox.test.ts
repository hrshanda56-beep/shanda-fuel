import { describe, expect, it } from 'vitest';
import {
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_ENTRIES,
  classifyFailure,
  discardQueued,
  enqueueSave,
  listQueued,
  outboxStorageKey,
  syncQueued,
  type QueuedStep,
  type StepResult,
} from './outbox';

function memoryStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

const NOW = 1_800_000_000_000;
const KEY = outboxStorageKey(['daily', 'm1']);
const steps = (n: number): QueuedStep[] =>
  Array.from({ length: n }, (_, i) => ({
    commandType: `Step${i}`,
    body: { i },
    idempotencyKey: `key-${i}`,
  }));
const save = (id: string, over: Partial<Parameters<typeof enqueueSave>[1]> = {}) => ({
  id,
  url: '/api/forecourt/commands',
  label: 'Daily report',
  steps: steps(3),
  nextIndex: 0,
  version: 4,
  ...over,
});

describe('queueing', () => {
  it('keeps a failed save and reads it back in order', () => {
    const store = memoryStore();
    expect(enqueueSave(KEY, save('a'), NOW, store)).toBe(true);
    expect(enqueueSave(KEY, save('b'), NOW + 1, store)).toBe(true);
    expect(listQueued(KEY, NOW + 2, store).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('keeps one copy of the same attempt', () => {
    const store = memoryStore();
    enqueueSave(KEY, save('a', { nextIndex: 0 }), NOW, store);
    enqueueSave(KEY, save('a', { nextIndex: 2 }), NOW, store);
    const [only, ...rest] = listQueued(KEY, NOW, store);
    expect(rest).toEqual([]);
    expect(only!.nextIndex).toBe(2);
  });

  it('refuses to grow without limit', () => {
    const store = memoryStore();
    for (let i = 0; i < OUTBOX_MAX_ENTRIES; i += 1) enqueueSave(KEY, save(`s${i}`), NOW, store);
    expect(enqueueSave(KEY, save('one-too-many'), NOW, store)).toBe(false);
  });

  it('drops saves older than a week and ignores corrupt storage', () => {
    const store = memoryStore();
    enqueueSave(KEY, save('a'), NOW, store);
    expect(listQueued(KEY, NOW + OUTBOX_MAX_AGE_MS, store)).toHaveLength(1);
    expect(listQueued(KEY, NOW + OUTBOX_MAX_AGE_MS + 1, store)).toHaveLength(0);
    for (const bad of ['nope', '{}', '[{"id":1}]', '[{"id":"a","steps":"x"}]']) {
      expect(listQueued(KEY, NOW, memoryStore({ [KEY]: bad }))).toEqual([]);
    }
  });

  it('can be discarded, and is separate for each person', () => {
    const store = memoryStore();
    const other = outboxStorageKey(['daily', 'm2']);
    enqueueSave(KEY, save('a'), NOW, store);
    enqueueSave(other, save('b'), NOW, store);
    discardQueued(KEY, 'a', NOW, store);
    expect(listQueued(KEY, NOW, store)).toEqual([]);
    expect(listQueued(other, NOW, store)).toHaveLength(1);
  });

  it('survives a store that refuses writes', () => {
    const blocked = {
      getItem: () => null,
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => undefined,
    };
    expect(enqueueSave(KEY, save('a'), NOW, blocked)).toBe(false);
    expect(enqueueSave(KEY, save('a'), NOW, null)).toBe(false);
  });
});

describe('classifyFailure', () => {
  it.each([
    [409, 'conflict'],
    [500, 'retry'],
    [503, 'retry'],
    [429, 'retry'],
    [401, 'retry'],
    [400, 'rejected'],
    [403, 'rejected'],
    [422, 'rejected'],
  ])('status %i is %s', (status, kind) => {
    expect(classifyFailure(status, 'm').kind).toBe(kind);
  });
});

describe('syncQueued', () => {
  const ok = (version: number | null = null): StepResult => ({ kind: 'ok', version });

  it('sends every step once, in order, with the running version and the original keys', async () => {
    const store = memoryStore();
    enqueueSave(KEY, save('a'), NOW, store);
    const calls: Array<[string, string, number]> = [];
    const outcome = await syncQueued(
      KEY,
      async (step, version, queued) => {
        calls.push([queued.id, step.idempotencyKey, version]);
        return ok(version + 1);
      },
      NOW,
      store,
    );
    expect(calls).toEqual([
      ['a', 'key-0', 4],
      ['a', 'key-1', 5],
      ['a', 'key-2', 6],
    ]);
    expect(outcome).toMatchObject({ sent: ['a'], conflicts: [], rejected: [], waiting: 0 });
    expect(listQueued(KEY, NOW, store)).toEqual([]);
  });

  it('resumes after the last accepted step and never resends it', async () => {
    const store = memoryStore();
    enqueueSave(KEY, save('a'), NOW, store);
    let attempt = 0;
    const first = await syncQueued(
      KEY,
      async (_step, version) => (++attempt === 2 ? { kind: 'retry' } : ok(version + 1)),
      NOW,
      store,
    );
    expect(first).toMatchObject({ sent: [], waiting: 1 });
    expect(listQueued(KEY, NOW, store)[0]).toMatchObject({ nextIndex: 1, version: 5 });

    const keys: string[] = [];
    const second = await syncQueued(
      KEY,
      async (step, version) => {
        keys.push(step.idempotencyKey);
        return ok(version + 1);
      },
      NOW,
      store,
    );
    expect(keys).toEqual(['key-1', 'key-2']);
    expect(second.sent).toEqual(['a']);
  });

  it('stops everything when the connection is down, sending nothing further', async () => {
    const store = memoryStore();
    enqueueSave(KEY, save('a'), NOW, store);
    enqueueSave(KEY, save('b'), NOW + 1, store);
    let calls = 0;
    const outcome = await syncQueued(
      KEY,
      async () => {
        calls += 1;
        throw new TypeError('Failed to fetch');
      },
      NOW + 2,
      store,
    );
    expect(calls).toBe(1);
    expect(outcome.waiting).toBe(2);
  });

  it('marks a conflict for a person and does not retry it, but carries on with the next save', async () => {
    const store = memoryStore();
    enqueueSave(KEY, save('a'), NOW, store);
    enqueueSave(KEY, save('b', { steps: steps(1) }), NOW + 1, store);
    const sentFor: string[] = [];
    const outcome = await syncQueued(
      KEY,
      async (_step, version, queued) => {
        sentFor.push(queued.id);
        return queued.id === 'a'
          ? { kind: 'conflict', message: 'This record was changed elsewhere' }
          : ok(version + 1);
      },
      NOW + 2,
      store,
    );
    expect(outcome).toMatchObject({ conflicts: ['a'], sent: ['b'], waiting: 0 });
    expect(listQueued(KEY, NOW + 2, store)).toEqual([
      expect.objectContaining({
        id: 'a',
        status: 'CONFLICT',
        message: 'This record was changed elsewhere',
      }),
    ]);

    sentFor.length = 0;
    await syncQueued(KEY, async () => ok(), NOW + 3, store);
    expect(sentFor).toEqual([]);
  });

  it('keeps a rejected save for review', async () => {
    const store = memoryStore();
    enqueueSave(KEY, save('a'), NOW, store);
    const outcome = await syncQueued(
      KEY,
      async () => ({ kind: 'rejected', message: 'Not allowed' }),
      NOW,
      store,
    );
    expect(outcome.rejected).toEqual(['a']);
    expect(listQueued(KEY, NOW, store)[0]).toMatchObject({ status: 'REJECTED' });
  });
});
