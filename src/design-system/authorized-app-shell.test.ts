import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getServerShellAccess: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('./app-shell', () => ({
  AppShell: (props: Record<string, unknown>) => props,
}));
vi.mock('./navigation-projection', () => ({ emptyNavigationProjection: [] }));
vi.mock('./navigation-server', () => ({
  getServerShellAccess: mocks.getServerShellAccess,
}));
vi.mock('@/platform/auth/provider', () => ({ getAuthProviderName: () => 'BETTER_AUTH' }));
vi.mock('./entry/entry-shell', () => ({ EntryShell: () => null }));
vi.mock('./entry/workplace-views', () => ({ NoWorkplace: () => null }));

import { AuthorizedAppShell } from './authorized-app-shell';

const access = {
  status: 'ready' as const,
  projection: [],
  current: {
    organisationId: 'tenant-1',
    stationId: 'station-1',
    allStations: false,
  },
};

describe('authorized app shell request-local reuse', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not resolve the shell a second time when a parent already verified it', async () => {
    const result = await AuthorizedAppShell({ children: null, shellAccess: access });

    expect(mocks.getServerShellAccess).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      props: { navigationProjection: [], authProvider: 'BETTER_AUTH' },
    });
  });

  it('retains the standalone shell resolution path for other pages', async () => {
    mocks.getServerShellAccess.mockResolvedValue(access);

    await AuthorizedAppShell({ children: null });

    expect(mocks.getServerShellAccess).toHaveBeenCalledTimes(1);
  });
});
