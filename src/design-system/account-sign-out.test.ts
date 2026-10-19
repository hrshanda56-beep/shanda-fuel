import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.hoisted(() => vi.fn());
const useClerk = vi.hoisted(() => vi.fn(() => ({ signOut })));
vi.mock('@clerk/nextjs', () => ({ useClerk }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import { AccountSignOutItem } from './account-sign-out';

describe('Clerk account menu sign-out', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders an accessible sign-out button backed by Clerk by default', () => {
    const html = renderToStaticMarkup(createElement(AccountSignOutItem, {}));
    expect(html).toContain('class="account-menu-item"');
    expect(html).toContain('type="button"');
    expect(html).toContain('>Sign out<');
    expect(html).not.toContain('role="menuitem"');
    expect(html).not.toContain('disabled');
    expect(useClerk).toHaveBeenCalledTimes(1);
  });

  it('does not sign out merely by rendering', () => {
    renderToStaticMarkup(createElement(AccountSignOutItem, { provider: 'CLERK' }));
    expect(signOut).not.toHaveBeenCalled();
  });
});
