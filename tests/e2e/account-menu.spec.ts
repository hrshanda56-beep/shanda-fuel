import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/*
 * Account menu (approved frozen AccountMenu + PR #120 provider-aware sign-out).
 * Database-free: runs on the synthetic navigation fixture with Better Auth selected
 * (AUTH_PROVIDER=BETTER_AUTH). Network calls are routed in the test; nothing real
 * is contacted. Clerk-mode sign-out has no automated path (needs a Clerk test
 * instance); this suite proves Clerk is never touched in Better Auth mode.
 */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 320, height: 640 };

async function waitForHydration(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
}

const CONTEXT_QUERY = '?tenantId=t-1&stationId=s-1';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/context**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          available: { organisations: [] },
          current: null,
          route: {
            pathname: '/reports',
            policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: true },
          },
          persistedContextInvalid: false,
        },
      }),
    });
  });
  for (const endpoint of ['reports/management', 'settlements/summary', 'settlements/unmatched']) {
    await page.route(`**/api/${endpoint}**`, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Dependency unavailable in account-menu test' }),
      }),
    );
  }
});

async function openMenu(page: Page) {
  await page.goto(`/reports${CONTEXT_QUERY}`);
  await waitForHydration(page);
  const trigger = page.locator('.shell-account-trigger:visible');
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Account menu' });
  await expect(menu).toBeVisible();
  return { trigger, menu };
}

test.describe('account menu items', () => {
  test.use({ viewport: DESKTOP });

  test('keeps the approved identity and theme and adds Account settings and Sign out', async ({
    page,
  }) => {
    const { menu } = await openMenu(page);
    await expect(menu.locator('.account-menu-theme')).toBeVisible();
    const items = menu.getByRole('menuitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveText('Account settings');
    await expect(items.nth(1)).toHaveText('Sign out');
  });

  test('Account settings goes to /settings and keeps the work context', async ({ page }) => {
    const { menu } = await openMenu(page);
    const link = menu.getByRole('menuitem', { name: 'Account settings' });
    await expect(link).toHaveAttribute('href', /^\/settings(\?|$)/);
    expect(await link.getAttribute('href')).toContain('tenantId=t-1');
    await link.click();
    await page.waitForURL(/\/settings/);
    await expect(menu).toHaveCount(0);
  });

  test('has no accessibility violations with the menu open', async ({ page }) => {
    await openMenu(page);
    // `aria-required-children` is excluded on purpose: the approved frozen AccountMenu
    // puts the theme radio group inside role="menu" (pre-existing, reported to the
    // frontend owner). Everything else must stay clean, including the new items.
    const results = await new AxeBuilder({ page })
      .include('.shell-account-menu')
      .disableRules(['aria-required-children'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('keyboard: opens, moves through the items, Escape returns focus to the trigger', async ({
    page,
  }) => {
    await page.goto(`/reports${CONTEXT_QUERY}`);
    await waitForHydration(page);
    const trigger = page.locator('.shell-account-trigger:visible');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Account menu' });
    await expect(menu).toBeFocused();

    // Tab order inside the menu reaches both items, in order.
    const settings = menu.getByRole('menuitem', { name: 'Account settings' });
    const signOut = menu.getByRole('menuitem', { name: 'Sign out' });
    await settings.focus();
    await expect(settings).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(signOut).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test.describe('sign out (Better Auth selected on the server)', () => {
  test.use({ viewport: DESKTOP });

  test('signs out through Better Auth, never Clerk, and lands on /login', async ({ page }) => {
    const clerkRequests: string[] = [];
    page.on('request', (request) => {
      // Network calls to Clerk (its API, its proxy route). Chunk names are checked
      // against a production build instead (dev servers preload split chunks).
      if (/\/api\/clerk|clerk\.(com|dev|accounts)/i.test(request.url())) {
        clerkRequests.push(request.url());
      }
    });
    let signOutCalls = 0;
    await page.route('**/api/auth/sign-out', async (route) => {
      signOutCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });
    const { menu } = await openMenu(page);
    await menu.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login$/);
    expect(signOutCalls).toBe(1);
    // Better Auth mode must not call Clerk at all.
    expect(clerkRequests).toEqual([]);
  });

  test('a failed sign out says so, keeps the menu and the page, and can be retried', async ({
    page,
  }) => {
    let calls = 0;
    await page.route('**/api/auth/sign-out', (route) => {
      calls += 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    const { menu } = await openMenu(page);
    const signOut = menu.getByRole('menuitem', { name: 'Sign out' });
    await signOut.click();
    await expect(menu.getByRole('alert')).toHaveText('Sign out failed. Please try again.');
    await expect(signOut).toBeEnabled();
    expect(page.url()).toContain('/reports');
    await signOut.click();
    await expect.poll(() => calls).toBe(2);
  });
});

test.describe('responsive', () => {
  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`fits a ${viewport.width}px phone with tap-sized items`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { menu } = await openMenu(page);
      const box = await menu.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      for (const item of await menu.getByRole('menuitem').all()) {
        // Layout height, not the animated bounding box (the panel scales in).
        expect(
          await item.evaluate((element) => (element as HTMLElement).offsetHeight),
        ).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
    });
  }
});
