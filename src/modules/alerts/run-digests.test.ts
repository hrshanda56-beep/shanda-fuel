import { describe, expect, it, vi } from 'vitest';
import type { ActionItem } from '../approvals/action-center-model';
import { runDigests, type DigestPorts, type DigestRecipient } from './run-digests';

const recipient = (n: number): DigestRecipient => ({
  tenantId: 't',
  stationId: `s${n}`,
  stationName: `Station ${n}`,
  membershipId: `m${n}`,
  email: `p${n}@example.test`,
  name: `Person ${n}`,
});
const alert = (id: string): ActionItem => ({
  id,
  area: 'Operations',
  title: id,
  detail: 'd',
  href: '/x',
  tone: 'attention',
});

function ports(overrides: Partial<DigestPorts> = {}) {
  const sent: string[] = [];
  const recorded: Array<{ station: string; ids: readonly string[] }> = [];
  const base: DigestPorts = {
    loadAlerts: async () => ({ items: [alert('a')], unavailable: [] }),
    lastSentItemIds: async () => [],
    recordSent: async (r, ids) => void recorded.push({ station: r.stationId, ids }),
    send: async (message) => {
      sent.push(message.to);
      return { messageId: `msg-${sent.length}` };
    },
    appUrl: 'https://fuel.shandahr.com',
    ...overrides,
  };
  return { base, sent, recorded };
}

describe('runDigests', () => {
  it('emails each person who has something new and remembers what was sent', async () => {
    const { base, sent, recorded } = ports();
    const result = await runDigests([recipient(1), recipient(2)], base);
    expect(result).toEqual({ sent: 2, skipped: 0, failed: 0 });
    expect(sent).toEqual(['p1@example.test', 'p2@example.test']);
    expect(recorded).toEqual([
      { station: 's1', ids: ['a'] },
      { station: 's2', ids: ['a'] },
    ]);
  });

  it('skips people with nothing new, without sending', async () => {
    const { base, sent } = ports({ lastSentItemIds: async () => ['a'] });
    expect(await runDigests([recipient(1)], base)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(sent).toEqual([]);
  });

  it('keeps going when one person’s alerts cannot be loaded', async () => {
    const onFailure = vi.fn();
    const { base, sent } = ports({
      loadAlerts: async (r) => {
        if (r.stationId === 's1') throw new Error('boom');
        return { items: [alert('a')], unavailable: [] };
      },
      onFailure,
    });
    expect(await runDigests([recipient(1), recipient(2)], base)).toEqual({
      sent: 1,
      skipped: 0,
      failed: 1,
    });
    expect(sent).toEqual(['p2@example.test']);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ stationId: 's1' }),
      'load',
      expect.any(Error),
    );
  });

  it('does not record an email that was not sent', async () => {
    const { base, recorded } = ports({
      send: async () => {
        throw new Error('provider down');
      },
    });
    expect(await runDigests([recipient(1)], base)).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(recorded).toEqual([]);
  });

  it('counts an email as sent even if remembering it fails, and reports the problem', async () => {
    const onFailure = vi.fn();
    const { base, sent } = ports({
      recordSent: async () => {
        throw new Error('db down');
      },
      onFailure,
    });
    expect(await runDigests([recipient(1)], base)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(onFailure).toHaveBeenCalledWith(expect.anything(), 'record', expect.any(Error));
  });
});
