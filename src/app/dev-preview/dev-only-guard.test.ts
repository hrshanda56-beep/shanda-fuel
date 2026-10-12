import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Development-only surfaces (/dev-preview/**, /design-system, /design-system/entry)
 * must be unreachable outside `next dev`. These tests cover every page, layout
 * and handler by discovery, so a new route added under either prefix is
 * checked automatically (and a zero-match glob fails the suite).
 */

type Loader = () => Promise<Record<string, unknown>>;
const pageLoaders = {
  ...import.meta.glob('/src/app/dev-preview/**/page.tsx'),
  ...import.meta.glob('/src/app/design-system/**/page.tsx'),
  ...import.meta.glob('/src/app/foundation/**/page.tsx'),
} as Record<string, Loader>;
const layoutLoaders = import.meta.glob('/src/app/dev-preview/**/layout.tsx') as Record<
  string,
  Loader
>;
const handlerLoaders = import.meta.glob('/src/app/dev-preview/**/route.ts') as Record<
  string,
  Loader
>;

// Load every module under the default (test) environment first: React's JSX
// runtime differs under NODE_ENV=production. Each guard reads NODE_ENV when it
// runs, so the environment is stubbed per call below.
const pages = new Map<string, (props: unknown) => unknown>();
const layouts: Array<(props: unknown) => unknown> = [];
const handlers: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  for (const [path, load] of Object.entries(pageLoaders)) {
    pages.set(path, (await load()).default as (props: unknown) => unknown);
  }
  for (const load of Object.values(layoutLoaders)) {
    layouts.push((await load()).default as (props: unknown) => unknown);
  }
  for (const load of Object.values(handlerLoaders)) handlers.push(await load());
  // Importing every preview page is slow when the whole suite runs in parallel.
}, 120_000);

afterEach(() => {
  vi.unstubAllEnvs();
});

async function expectNotFound(call: () => unknown) {
  // Next's notFound() throws an error whose digest carries the 404 status.
  await expect(Promise.resolve().then(call)).rejects.toMatchObject({
    digest: expect.stringContaining('404'),
  });
}

const params = new Proxy({}, { get: () => 'x' });

describe('dev-only route discovery', () => {
  it('finds the pages, layout and handlers it is meant to protect', () => {
    expect(Object.keys(pageLoaders).length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(layoutLoaders)).toHaveLength(1);
    expect(Object.keys(handlerLoaders)).toHaveLength(2);
  });
});

describe.each(['production', 'test', 'staging'])('NODE_ENV=%s', (nodeEnv) => {
  it('every page renders the 404, before reading params or data', async () => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    expect(pages.size).toBeGreaterThanOrEqual(9);
    for (const [path, page] of pages) {
      await expectNotFound(() => page({ params: Promise.resolve(params), searchParams: {} }));
      expect(path).toBeTruthy();
    }
  });

  it('the dev-preview layout renders the 404', async () => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    expect(layouts).toHaveLength(1);
    for (const layout of layouts) {
      await expectNotFound(() => layout({ children: null }));
    }
  });

  it('handlers return an empty 404 with no cookie and no synthetic data', async () => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    expect(handlers).toHaveLength(2);
    for (const handlerModule of handlers) {
      const get = handlerModule.GET as (...args: unknown[]) => Promise<Response>;
      const response = await get(
        new Request('https://example.test/dev-preview/scenario/normal?tenantId=t'),
        { params: Promise.resolve({ name: 'normal' }) },
      );
      expect(response.status).toBe(404);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).toBe('');
    }
  });
});

describe('NODE_ENV=development (isolated local preview)', () => {
  it('the scenario handler still redirects and sets its preview cookie', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { GET } = (await import('./scenario/[name]/route')) as {
      GET: (request: Request, context: { params: Promise<{ name: string }> }) => Promise<Response>;
    };
    const response = await GET(
      new Request('https://example.test/dev-preview/scenario/normal?tenantId=t1'),
      { params: Promise.resolve({ name: 'normal' }) },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/my-shift?tenantId=t1');
    expect(response.headers.get('set-cookie')).toContain('Path=/');
  });

  it('the layout lets previews render', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { default: Layout } = (await import('./layout')) as {
      default: (props: { children: string }) => unknown;
    };
    expect(Layout({ children: 'ok' })).toBe('ok');
  });
});
