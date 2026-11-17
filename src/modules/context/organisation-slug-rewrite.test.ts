import { describe, expect, it, vi } from 'vitest';

import {
  carriesOrganisationSlug,
  pageUrlWithOrganisationId,
  resolveOrganisationSlug,
} from './organisation-slug-rewrite';
import { resolveAvailableContext } from './resolution';
import { contextRoutePolicy, readContextRoute } from './routes';
import type { AvailableContext } from './contracts';

const ID = '11111111-1111-4111-8111-111111111111';

describe('organisation slug rewrite', () => {
  it('only applies to page loads with a slug and no explicit id', () => {
    const page = (path: string) => new URL(`https://fuel.example${path}`);
    expect(carriesOrganisationSlug(page('/finance?org=shanda-fuel'), 'GET')).toBe(true);
    expect(carriesOrganisationSlug(page('/finance?org=shanda-fuel'), 'POST')).toBe(false);
    expect(carriesOrganisationSlug(page(`/finance?org=shanda-fuel&tenantId=${ID}`), 'GET')).toBe(
      false,
    );
    expect(carriesOrganisationSlug(page('/api/context?org=shanda-fuel'), 'GET')).toBe(false);
    expect(carriesOrganisationSlug(page('/finance?org=Not%20A%20Slug'), 'GET')).toBe(false);
    expect(carriesOrganisationSlug(page('/finance'), 'GET')).toBe(false);
  });

  it('swaps the slug for the id and keeps everything else', () => {
    const next = pageUrlWithOrganisationId(
      new URL('https://fuel.example/reports?org=shanda-fuel&allStations=true'),
      ID,
    );
    expect(next.searchParams.get('tenantId')).toBe(ID);
    expect(next.searchParams.has('org')).toBe(false);
    expect(next.searchParams.get('allStations')).toBe('true');
  });

  it('resolves through the context endpoint with the visitor cookies', async () => {
    const network = vi.fn(async () =>
      Response.json({ data: { current: { organisationId: ID } } }),
    ) as unknown as typeof fetch;
    await expect(
      resolveOrganisationSlug('https://fuel.example', 'shanda-fuel', { cookie: 'a=b' }, network),
    ).resolves.toBe(ID);
    const [url, init] = vi.mocked(network).mock.calls[0]!;
    expect(String(url)).toBe('https://fuel.example/api/context?pathname=%2F&org=shanda-fuel');
    expect((init!.headers as Record<string, string>).cookie).toBe('a=b');
  });

  it('does not resolve when the endpoint refuses or fails', async () => {
    const refuse = (async () => Response.json({}, { status: 403 })) as unknown as typeof fetch;
    const fail = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    for (const network of [refuse, fail])
      await expect(resolveOrganisationSlug('https://x.example', 'a', {}, network)).resolves.toBe(
        null,
      );
  });
});

describe('slug resolution is limited to the visitor’s own organisations', () => {
  const available: AvailableContext = {
    organisations: [
      {
        id: ID,
        name: 'Shanda Fuel',
        slug: 'shanda-fuel',
        legalEntities: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Main', stations: [] }],
      },
    ],
  };
  const resolve = (query: string) =>
    resolveAvailableContext(
      available,
      readContextRoute('/', new URLSearchParams(query)),
      contextRoutePolicy('/'),
      { invalid: false },
    );

  it('selects the organisation that owns the slug', () => {
    expect(resolve('org=shanda-fuel').current?.organisationId).toBe(ID);
  });

  it('refuses a slug that is not in the visitor’s list', () => {
    expect(() => resolve('org=someone-else')).toThrow();
  });
});
