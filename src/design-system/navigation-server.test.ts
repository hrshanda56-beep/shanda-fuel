import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveCurrentContext: vi.fn(),
  resolveTenantExecutionContext: vi.fn(),
  buildNavigationProjection: vi.fn(() => []),
  allowsE2ENavigationFixture: vi.fn(() => false),
}));

vi.mock('../modules/context/server', () => ({
  resolveCurrentContext: mocks.resolveCurrentContext,
}));

vi.mock('../modules/tenancy/server', () => ({
  resolveTenantExecutionContext: mocks.resolveTenantExecutionContext,
}));

vi.mock('./navigation-projection', () => ({
  buildNavigationProjection: mocks.buildNavigationProjection,
  allowsE2ENavigationFixture: mocks.allowsE2ENavigationFixture,
  syntheticNavigationProjection: [],
  E2E_NAVIGATION_FIXTURE_HEADER: 'x-shanda-fuel-e2e-nav',
}));

import { getServerShellAccess } from './navigation-server';

const availableContext = {
  organisations: [
    {
      id: 'tenant-1',
      name: 'Tenant 1',
      legalEntities: [{ id: 'legal-entity-1', name: 'Legal Entity 1', stations: [] }],
    },
  ],
};

describe('server shell session gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps a prefixed Better Auth session on the authenticated root-shell path', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'BETTER_AUTH');
    mocks.resolveCurrentContext.mockResolvedValue({
      available: availableContext,
      current: { organisationId: 'tenant-1', legalEntityId: 'legal-entity-1' },
    });
    mocks.resolveTenantExecutionContext.mockResolvedValue({
      authorization: {},
      membership: {},
      transaction: {},
    });

    await expect(
      getServerShellAccess(
        new Headers({
          host: 'fuel.shandahr.com',
          cookie: 'shanda-fuel.session_token=opaque',
        }),
      ),
    ).resolves.toMatchObject({ status: 'ready' });
  });

  it('does not treat the unprefixed Better Auth cookie as authentication', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'BETTER_AUTH');

    await expect(
      getServerShellAccess(
        new Headers({
          host: 'fuel.shandahr.com',
          cookie: 'session_token=opaque',
        }),
      ),
    ).resolves.toEqual({ status: 'signed-out' });
    expect(mocks.resolveCurrentContext).not.toHaveBeenCalled();
  });
});
