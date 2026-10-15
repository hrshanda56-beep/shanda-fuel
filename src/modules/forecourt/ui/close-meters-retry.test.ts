import { describe, expect, it } from 'vitest';
import { replayCloseMeters, type CloseMetersJournal } from './close-meters-retry';

describe('close meters partial-write recovery', () => {
  it('replays identical persisted bodies and keys after a committed seal response is lost', async () => {
    const journal: CloseMetersJournal = {
      commands: [
        {
          body: {
            commandType: 'SealSegment',
            endAt: '2026-10-15T10:00:00.000Z',
            responsibleAttendantId: 'attendant-a',
          },
          key: 'seal-a',
        },
        { body: { commandType: 'CloseMeters', expectedVersion: 3 }, key: 'close-a' },
        { body: { commandType: 'CompleteShift', expectedVersion: 4 }, key: 'complete-a' },
      ],
      readings: [{ nozzleId: 'a', opening: '10', closing: '20' }],
    };
    const committed = new Map<string, string>();
    let lostResponse = true;
    const post = async (body: Record<string, unknown>, key: string) => {
      const existing = committed.get(key);
      if (existing) expect(JSON.stringify(body)).toBe(existing);
      committed.set(key, JSON.stringify(body));
      if (lostResponse) {
        lostResponse = false;
        throw new Error('connection lost after commit');
      }
    };
    await expect(replayCloseMeters(journal, post)).rejects.toThrow('connection lost');
    expect(committed.size).toBe(1);
    expect(journal.uncertain).toBe(true);
    // A reopened sheet loads this same attempt instead of deriving new time, IDs or attribution.
    await replayCloseMeters(JSON.parse(JSON.stringify(journal)) as CloseMetersJournal, post);
    expect([...committed.keys()]).toEqual(['seal-a', 'close-a', 'complete-a']);
  });
  it('distinguishes a rejected first request from partial or uncertain writes', async () => {
    const rejected: CloseMetersJournal = { commands: [{ body: {}, key: 'first' }], readings: [] };
    await expect(
      replayCloseMeters(rejected, async () => {
        throw { definitiveRejection: true };
      }),
    ).rejects.toEqual({ definitiveRejection: true });
    expect(rejected.confirmedCount ?? 0).toBe(0);
    expect(rejected.uncertain).toBeUndefined();
    const partial: CloseMetersJournal = {
      commands: [
        { body: {}, key: 'first' },
        { body: {}, key: 'second' },
      ],
      readings: [],
    };
    await expect(
      replayCloseMeters(partial, async (_, key) => {
        if (key === 'second') throw { definitiveRejection: true };
      }),
    ).rejects.toEqual({ definitiveRejection: true });
    expect(partial.confirmedCount).toBe(1);
  });
});
