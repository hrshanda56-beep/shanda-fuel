import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ view: vi.fn(), session: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('./invitation', () => ({ resolveInvitationView: mocks.view }));
vi.mock('./session', () => ({ hasActiveSession: mocks.session }));
vi.mock('./entry-shell', () => ({
  EntryShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./invite-views', () => ({ InviteUnavailable: () => 'Unavailable' }));
vi.mock('./invite-acceptance', () => ({
  ExistingInviteFlow: () => 'Accept invitation',
  NewInviteFlow: () => 'Create invited account',
}));
vi.mock('./clerk-login-form', () => ({
  ClerkLoginForm: ({ next }: { next: string }) =>
    createElement('a', { href: next }, 'Clerk sign in'),
}));

import InvitePage from '@/app/invite/[token]/page';

describe('Clerk invitation routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['existing-identity', 'new-identity'])(
    'requires server acceptance for signed-in %s',
    async (kind) => {
      mocks.view.mockResolvedValue({
        kind,
        organisationName: 'Organisation',
        email: 'invited@example.com',
      });
      mocks.session.mockResolvedValue(true);
      const html = renderToStaticMarkup(
        await InvitePage({ params: Promise.resolve({ token: 'invite-token' }) }),
      );
      expect(html).toContain('Accept invitation');
      expect(html).not.toContain('Create invited account');
    },
  );

  it('preserves the invitation destination through existing-account Clerk sign in', async () => {
    mocks.view.mockResolvedValue({ kind: 'existing-identity' });
    mocks.session.mockResolvedValue(false);
    const html = renderToStaticMarkup(
      await InvitePage({ params: Promise.resolve({ token: 'invite-token' }) }),
    );
    expect(html).toContain('Clerk sign in');
    expect(html).toContain('/invite/invite-token');
  });

  it('offers account creation for a signed-out new identity', async () => {
    mocks.view.mockResolvedValue({
      kind: 'new-identity',
      organisationName: 'Organisation',
      email: 'invited@example.com',
    });
    mocks.session.mockResolvedValue(false);
    expect(
      renderToStaticMarkup(
        await InvitePage({ params: Promise.resolve({ token: 'invite-token' }) }),
      ),
    ).toContain('Create invited account');
  });

  it('keeps unavailable links unavailable without resolving a session', async () => {
    mocks.view.mockResolvedValue({ kind: 'unavailable' });
    expect(
      renderToStaticMarkup(
        await InvitePage({ params: Promise.resolve({ token: 'invite-token' }) }),
      ),
    ).toContain('Unavailable');
    expect(mocks.session).not.toHaveBeenCalled();
  });
});
