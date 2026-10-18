import { createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), resolve: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost' }) }));
vi.mock('@/design-system/navigation-server', () => ({
  getServerShellAccess: mocks.access,
  getServerShellAccessForResolution: async (
    _request: Request,
    access: object,
    resolution: object,
  ) => ({ ...access, ...resolution, resolution }),
  requestFromHeaders: () => new Request('http://localhost/'),
}));
vi.mock('@/design-system/authorized-app-shell', () => ({
  AuthorizedAppShell: ({ children }: { children: unknown }) => children,
}));
vi.mock('./resolution', () => ({ resolveAvailableContext: mocks.resolve }));
import { ServerDataPage } from './server-page';
import { AppError } from '@/platform/errors';
const resolution = {
  current: { organisationId: 'tenant', stationId: 'station', allStations: false },
  available: { organisations: [] },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ status: 'ready', resolution });
  mocks.resolve.mockReturnValue(resolution);
});
async function html(node: Awaited<ReturnType<typeof ServerDataPage>>) {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}
it('renders initial query data on the server with validated context', async () => {
  const load = vi
    .fn<(...args: unknown[]) => Promise<string>>()
    .mockResolvedValue('Loaded settlement');
  const node = await ServerDataPage({
    pathname: '/customers',
    load,
    render: (data) => createElement('p', null, data),
    fallback: 'fallback',
  });
  expect(await html(node)).toContain('Loaded settlement');
  expect(load).toHaveBeenCalledTimes(1);
  expect(load.mock.calls[0]?.[1]).toBe(resolution);
});
it('does not start reads when context validation fails', async () => {
  mocks.resolve.mockImplementation(() => {
    throw new Error('foreign station');
  });
  const load = vi.fn();
  expect(
    await html(
      await ServerDataPage({
        pathname: '/customers',
        load,
        render: () => 'secret',
        fallback: 'fallback',
      }),
    ),
  ).toContain('Work context unavailable');
  expect(load).not.toHaveBeenCalled();
});
it('renders a truthful unavailable state without leaking query errors', async () => {
  const load = vi.fn().mockRejectedValue(new Error('private SQL details'));
  const output = await html(
    await ServerDataPage({
      pathname: '/customers',
      load,
      render: () => 'secret',
      fallback: 'fallback',
    }),
  );
  expect(output).toContain('Page data unavailable');
  expect(output).not.toContain('private SQL');
});
it('does not start data queries for signed-out access', async () => {
  mocks.access.mockResolvedValue({ status: 'signed-out' });
  const load = vi.fn();
  await html(
    await ServerDataPage({
      pathname: '/customers',
      load,
      render: () => 'secret',
      fallback: 'fallback',
    }),
  );
  expect(load).not.toHaveBeenCalled();
});

it('renders denied data access without exposing query data', async () => {
  const load = vi.fn().mockRejectedValue(new AppError('FORBIDDEN', 'private permission detail'));
  const output = await html(
    await ServerDataPage({
      pathname: '/customers',
      load,
      render: () => 'secret',
      fallback: 'fallback',
    }),
  );
  expect(output).not.toContain('secret');
  expect(output).not.toContain('private permission detail');
  expect(output).toContain('Access');
});
