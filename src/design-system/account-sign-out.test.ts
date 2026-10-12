import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useClerk = vi.hoisted(() => vi.fn(() => ({ signOut: vi.fn() })));
const signOut = vi.hoisted(() => vi.fn());

vi.mock('@clerk/nextjs', () => ({ useClerk }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/platform/auth/client', () => ({ authClient: { signOut } }));

import { AccountSignOutItem } from './account-sign-out';

function render(provider: 'BETTER_AUTH' | 'CLERK') {
  return renderToStaticMarkup(createElement(AccountSignOutItem, { provider }));
}

describe('account menu sign-out item', () => {
  beforeEach(() => {
    useClerk.mockClear();
    signOut.mockClear();
  });

  it('renders one accessible Sign out menu item for either provider', () => {
    for (const provider of ['BETTER_AUTH', 'CLERK'] as const) {
      const html = render(provider);
      expect(html).toContain('role="menuitem"');
      expect(html).toContain('type="button"');
      expect(html).toContain('>Sign out<');
      expect(html).not.toContain('disabled');
      expect(html).not.toContain('role="alert"');
    }
  });

  it('never runs the Clerk hook under Better Auth (no ClerkProvider is mounted there)', () => {
    render('BETTER_AUTH');
    expect(useClerk).not.toHaveBeenCalled();
  });

  it('runs the Clerk hook only when the server selected Clerk', () => {
    render('CLERK');
    expect(useClerk).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('does not sign out merely by rendering', () => {
    render('BETTER_AUTH');
    expect(signOut).not.toHaveBeenCalled();
  });
});
