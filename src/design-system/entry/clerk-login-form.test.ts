import type { FormEvent, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  setActive: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  setState: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => [initial, mocks.setState],
  useRef: () => ({ current: null }),
}));
vi.mock('@clerk/nextjs/legacy', () => ({
  useSignIn: () => ({
    isLoaded: true,
    signIn: { create: mocks.create },
    setActive: mocks.setActive,
  }),
}));
vi.mock('@clerk/nextjs', () => ({ SignIn: () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

import { ClerkLoginForm } from './clerk-login-form';

async function submit(next?: string) {
  const section = ClerkLoginForm({ next }) as ReactElement<{ children: ReactElement[] }>;
  const form = section.props.children.find((child) => child?.type === 'form') as ReactElement<{
    onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  }>;
  await form.props.onSubmit({
    preventDefault: vi.fn(),
    currentTarget: {},
  } as unknown as FormEvent<HTMLFormElement>);
}

describe('Clerk credential login', () => {
  it('provides a first-time activation link', () => {
    const section = ClerkLoginForm({}) as ReactElement<{ children: ReactElement[] }>;
    const footnote = section.props.children.find(
      (child) =>
        (child?.props as { className?: string } | undefined)?.className === 'entry-footnote',
    ) as ReactElement<{ children: ReactElement<{ href: string }> }>;
    expect(footnote.props.children.props.href).toBe('/join');
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'FormData',
      class {
        get(name: string) {
          return name === 'identifier' ? ' STAFF001 ' : 'test-password';
        }
      },
    );
    mocks.setActive.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('activates the completed Clerk session and preserves the invitation destination', async () => {
    mocks.create.mockResolvedValue({ status: 'complete', createdSessionId: 'session-1' });
    await submit('/invite/invitation-token');
    expect(mocks.create).toHaveBeenCalledWith({
      identifier: 'STAFF001',
      password: 'test-password',
    });
    expect(mocks.setActive).toHaveBeenCalledWith({ session: 'session-1' });
    expect(mocks.push).toHaveBeenCalledWith('/invite/invitation-token');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('rejects an external return destination', async () => {
    mocks.create.mockResolvedValue({ status: 'complete', createdSessionId: 'session-1' });
    await submit('https://external.example');
    expect(mocks.push).toHaveBeenCalledWith('/workplace');
  });

  it('requires Clerk verification before activating a second-factor session', async () => {
    mocks.create.mockResolvedValue({ status: 'needs_second_factor', createdSessionId: null });
    await submit('/invite/invitation-token');
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.setState).toHaveBeenCalledWith(true);
  });

  it('does not navigate when Clerk session activation fails', async () => {
    mocks.create.mockResolvedValue({ status: 'complete', createdSessionId: 'session-1' });
    mocks.setActive.mockRejectedValue(new Error('unavailable'));
    await submit();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.setState).toHaveBeenCalledWith(
      'Your details were accepted, but your session could not be started. Refresh the page and try again.',
    );
  });

  it('does not report a connection failure as an incorrect password', async () => {
    mocks.create.mockRejectedValue(new Error('network unavailable'));
    await submit();
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect(mocks.setState).toHaveBeenCalledWith(
      'Sign-in could not be completed. Check your connection, refresh the page and try again.',
    );
  });

  it('reports rejected credentials without disclosing account existence', async () => {
    mocks.create.mockRejectedValue({ errors: [{ code: 'form_identifier_not_found' }] });
    await submit();
    expect(mocks.setState).toHaveBeenCalledWith(
      'The sign-in details were not accepted. Check them and try again.',
    );
  });
});
