import type { ReactElement, FormEvent } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  active: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  state: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => [initial, mocks.state],
  useRef: () => ({ current: null }),
}));
vi.mock('@clerk/nextjs/legacy', () => ({
  useSignIn: () => ({ isLoaded: true, signIn: { create: mocks.create }, setActive: mocks.active }),
}));
vi.mock('@clerk/nextjs', () => ({ SignIn: () => null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
import { ManualActivationForm } from './manual-activation';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubGlobal(
    'FormData',
    class {
      get(key: string) {
        return (
          {
            staffNumber: 'sf-12345678',
            activationCode: '7K3M-9R2X',
            password: 'test-password-only',
            confirm: 'test-password-only',
          } as Record<string, string>
        )[key];
      }
    },
  );
  mocks.fetch.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllGlobals());
async function submit() {
  const view = ManualActivationForm() as ReactElement<{ children: ReactElement[] }>;
  const form = view.props.children.find((child) => child.type === 'form') as ReactElement<{
    onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  }>;
  await form.props.onSubmit({
    preventDefault: vi.fn(),
    currentTarget: {},
  } as unknown as FormEvent<HTMLFormElement>);
}
it('signs into Clerk only after successful activation and opens the workplace', async () => {
  mocks.create.mockResolvedValue({ status: 'complete', createdSessionId: 'session_test' });
  await submit();
  expect(mocks.create).toHaveBeenCalledWith({
    identifier: 'SF-12345678',
    password: 'test-password-only',
  });
  expect(mocks.active).toHaveBeenCalledWith({ session: 'session_test' });
  expect(mocks.replace).toHaveBeenCalledWith('/workplace');
});
it('does not repeat activation when automatic sign-in fails', async () => {
  mocks.create.mockRejectedValue(new Error('unavailable'));
  await submit();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.state).toHaveBeenCalledWith(expect.stringContaining('Your account was created'));
});
it('does not activate a session before Clerk challenges complete', async () => {
  mocks.create.mockResolvedValue({ status: 'needs_second_factor' });
  await submit();
  expect(mocks.active).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});
