import { describe, expect, it, vi } from 'vitest';
import { createContextReader } from './context-reader';
import type { ContextResolution } from './contracts';
const seed: ContextResolution = {
  available: {
    organisations: [
      {
        id: 'tenant-a',
        name: 'A',
        legalEntities: [
          {
            id: 'entity-a',
            name: 'Entity',
            stations: [{ id: 'station-a', name: 'Station', code: 'A', timezone: 'Africa/Harare' }],
          },
        ],
      },
    ],
  },
  current: {
    organisationId: 'tenant-a',
    legalEntityId: 'entity-a',
    stationId: 'station-a',
    allStations: false,
  },
  route: {
    pathname: '/',
    policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: true },
  },
  persistedContextInvalid: false,
};
describe('navigation-scoped context reader', () => {
  it('shares the server snapshot across header and feature without network discovery', async () => {
    const network = vi.fn();
    const read = createContextReader(seed, network);
    const responses = await Promise.all([
      read('/api/context?pathname=/customers'),
      read('/api/context?pathname=/customers'),
    ]);
    expect(await responses[0].json()).toMatchObject({ data: { current: seed.current } });
    expect(await responses[1].json()).toMatchObject({
      data: { route: { pathname: '/customers' } },
    });
    expect(network).not.toHaveBeenCalled();
  });
  it('rejects explicit cross-tenant scope instead of using remembered scope', async () => {
    const read = createContextReader(seed, vi.fn());
    const response = await read('/api/context?pathname=/customers&tenantId=tenant-b');
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty('data');
  });
  it('keeps fallback requests isolated between navigation readers', async () => {
    const network = vi.fn(async () => Response.json({ data: seed }));
    const read = createContextReader(undefined, network);
    await Promise.all([
      read('/api/context?pathname=/customers'),
      read('/api/context?pathname=/customers'),
    ]);
    expect(network).toHaveBeenCalledTimes(1);
    await createContextReader(undefined, network)('/api/context?pathname=/customers');
    expect(network).toHaveBeenCalledTimes(2);
  });
  it('does not retain failures and respects an aborted consumer', async () => {
    const network = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(Response.json({ data: seed }));
    const read = createContextReader(undefined, network);
    await expect(read('/api/context')).rejects.toThrow('offline');
    expect((await read('/api/context')).ok).toBe(true);
    const controller = new AbortController();
    controller.abort();
    await expect(read('/api/context', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('never serves writes from a read snapshot', async () => {
    const network = vi.fn(async () => Response.json({ ok: true }));
    await createContextReader(seed, network)('/api/context', { method: 'POST' });
    expect(network).toHaveBeenCalledTimes(1);
  });
});

describe('context refresh', () => {
  it('explicit reload bypasses the server snapshot', async () => {
    const network = vi.fn(async () => Response.json({ data: { ...seed, current: null } }));
    const read = createContextReader(seed, network);
    expect(await (await read('/api/context', { cache: 'reload' })).json()).toMatchObject({
      data: { current: null },
    });
    expect(network).toHaveBeenCalledOnce();
  });
  it('a new server snapshot replaces previous selection on the same URL', async () => {
    const network = vi.fn();
    const first = createContextReader(seed, network);
    const refreshed = createContextReader(
      { ...seed, available: { organisations: [] }, current: null },
      network,
    );
    expect(await (await first('/api/context?pathname=/customers')).json()).toMatchObject({
      data: { current: seed.current },
    });
    expect(await (await refreshed('/api/context?pathname=/customers')).json()).toMatchObject({
      data: { current: null },
    });
  });
});
