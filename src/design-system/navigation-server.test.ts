import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { AppError } from '../platform/errors';

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
    mocks.resolveCurrentContext.mockRejectedValue(
      new AppError('UNAUTHENTICATED', 'No Clerk session'),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps a Clerk session on the authenticated root-shell path', async () => {
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
          cookie: '__session=opaque',
        }),
      ),
    ).resolves.toMatchObject({
      status: 'ready',
      current: { organisationId: 'tenant-1', legalEntityId: 'legal-entity-1' },
    });
  });

  it('keeps a Clerk session on the root-shell path after station selection', async () => {
    mocks.resolveCurrentContext.mockResolvedValue({
      available: {
        organisations: [
          {
            id: 'tenant-1',
            name: 'Tenant 1',
            legalEntities: [
              {
                id: 'legal-entity-1',
                name: 'Legal Entity 1',
                stations: [
                  {
                    id: 'station-bindura',
                    code: 'BND',
                    name: 'Bindura',
                    timezone: 'Africa/Harare',
                  },
                ],
              },
            ],
          },
        ],
      },
      current: {
        organisationId: 'tenant-1',
        legalEntityId: 'legal-entity-1',
        stationId: 'station-bindura',
        allStations: false,
      },
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
          cookie: '__session=opaque; shanda-fuel-context=validated',
        }),
      ),
    ).resolves.toMatchObject({
      status: 'ready',
      current: {
        organisationId: 'tenant-1',
        legalEntityId: 'legal-entity-1',
        stationId: 'station-bindura',
      },
    });
  });

  it('does not treat an unrelated session cookie as authentication', async () => {
    await expect(
      getServerShellAccess(
        new Headers({
          host: 'fuel.shandahr.com',
          cookie: 'session_token=opaque',
        }),
      ),
    ).resolves.toEqual({ status: 'signed-out' });
    expect(mocks.resolveCurrentContext).toHaveBeenCalledTimes(1);
  });

  it('fails closed when authenticated context resolution rejects', async () => {
    mocks.resolveCurrentContext.mockRejectedValue(new Error('context unavailable'));

    await expect(
      getServerShellAccess(
        new Headers({
          host: 'fuel.shandahr.com',
          cookie: '__session=opaque',
        }),
      ),
    ).rejects.toThrow('context unavailable');
  });

  it('fails closed when the navigation projection cannot verify context', async () => {
    mocks.resolveCurrentContext.mockResolvedValue({
      available: availableContext,
      current: { organisationId: 'tenant-1' },
    });
    mocks.resolveTenantExecutionContext.mockRejectedValue(
      new Error('projection context unavailable'),
    );

    await expect(
      getServerShellAccess(
        new Headers({
          host: 'fuel.shandahr.com',
          cookie: '__session=opaque',
        }),
      ),
    ).rejects.toThrow('projection context unavailable');
  });

  it('uses the validated station selection for the shell projection without re-resolving context', async () => {
    mocks.resolveCurrentContext.mockResolvedValue({
      available: availableContext,
      current: {
        organisationId: 'tenant-1',
        legalEntityId: 'legal-entity-1',
        stationId: 'station-bindura',
        allStations: false,
      },
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
          cookie: '__session=opaque; shanda-fuel-context=validated',
        }),
      ),
    ).resolves.toMatchObject({ status: 'ready' });
    expect(mocks.resolveCurrentContext).toHaveBeenCalledTimes(1);
    expect(mocks.resolveTenantExecutionContext).toHaveBeenCalledWith(
      expect.objectContaining({ requestedTenantId: 'tenant-1' }),
    );
  });

  it('returns signed-out for an unauthenticated request so the shell redirects', async () => {
    await expect(getServerShellAccess(new Headers({ host: 'fuel.shandahr.com' }))).resolves.toEqual(
      { status: 'signed-out' },
    );
  });

  it('redirects only when verified session resolution reports unauthenticated', async () => {
    mocks.resolveCurrentContext.mockRejectedValue(
      new AppError('UNAUTHENTICATED', 'Session expired'),
    );
    await expect(
      getServerShellAccess(new Headers({ host: 'localhost:3000', cookie: '__session=opaque' })),
    ).resolves.toEqual({ status: 'signed-out' });
  });

  it('uses verified Clerk context even without the legacy unsuffixed session cookie', async () => {
    mocks.resolveCurrentContext.mockResolvedValue({
      available: availableContext,
      current: { organisationId: 'tenant-1' },
    });
    mocks.resolveTenantExecutionContext.mockResolvedValue({ authorization: {} });
    await expect(
      getServerShellAccess(new Headers({ host: 'localhost:3000' })),
    ).resolves.toMatchObject({ status: 'ready' });
  });
});
