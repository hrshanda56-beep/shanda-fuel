import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcceptInvitation } from './invite-views';

const mocks = vi.hoisted(() => ({
  accept: undefined as AcceptInvitation | undefined,
  fetch: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock('./invite-views', () => ({
  JoinWorkspaceForm: (props: { accept: AcceptInvitation }) => {
    mocks.accept = props.accept;
    return null;
  },
}));
vi.mock('./clerk-login-form', () => ({ ClerkLoginForm: () => null }));

import { NewInviteFlow } from './invite-acceptance';

describe('invitation identity creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    renderToStaticMarkup(
      createElement(NewInviteFlow, {
        token: 'invitation-token',
        organisationName: 'Inviting organisation',
        email: 'invited@example.com',
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('creates the invited identity and requires Clerk authentication before membership acceptance', async () => {
    mocks.fetch.mockResolvedValue(new Response('{}', { status: 201 }));
    expect(await mocks.accept?.('test-password')).toEqual({ ok: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/invite/invitation-token/signup',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        body: JSON.stringify({ token: 'invitation-token', password: 'test-password' }),
      }),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('does not proceed when the server refuses signup', async () => {
    mocks.fetch.mockResolvedValue(new Response('{}', { status: 403 }));
    expect(await mocks.accept?.('test-password')).toEqual({ ok: false });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
