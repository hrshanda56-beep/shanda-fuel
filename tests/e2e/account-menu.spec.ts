import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/*
 * Account menu (approved frozen AccountMenu look + PR #120 provider-aware sign-out). The panel is a
 * non-modal dialog (not an ARIA menu: it holds a theme radio group), so items are plain links/buttons.
 * Database-free: runs on the explicit development navigation fixture. Sign-out
 * tests substitute only Clerk's browser method to exercise UI success/errors;
 * authenticated provider revocation is verified separately.
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

async function openMenu(page: Page, signOutBehavior?: 'success' | 'failure') {
  await page.goto(`/reports${CONTEXT_QUERY}`);
  await waitForHydration(page);
  if (signOutBehavior) {
    await page.waitForFunction(() =>
      Boolean((window as unknown as { Clerk?: { loaded: boolean } }).Clerk?.loaded),
    );
    await page.evaluate((behavior) => {
      const scope = window as unknown as {
        Clerk: { signOut: () => Promise<void> };
        testSignOutCalls: number;
      };
      scope.testSignOutCalls = 0;
      scope.Clerk.signOut = async () => {
        scope.testSignOutCalls++;
        if (behavior === 'failure') throw new Error('simulated provider failure');
      };
    }, signOutBehavior);
  }
  const trigger = page.locator('.shell-account-trigger:visible');
  await trigger.click();
  const menu = page.getByRole('dialog', { name: 'Account menu' });
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
    const items = menu.locator('.account-menu-item');
    await expect(items).toHaveCount(2);
    await expect(menu.getByRole('link', { name: 'Account settings' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(items.nth(0)).toHaveText('Account settings');
    await expect(items.nth(1)).toHaveText('Sign out');
  });

  test('Account settings goes to /settings and keeps the work context', async ({ page }) => {
    const { menu } = await openMenu(page);
    const link = menu.getByRole('link', { name: 'Account settings' });
    await expect(link).toHaveAttribute('href', /^\/settings(\?|$)/);
    expect(await link.getAttribute('href')).toContain('tenantId=t-1');
    await link.click();
    await page.waitForURL(/\/settings/);
    await expect(menu).toHaveCount(0);
  });

  test('has no accessibility violations with the panel open (light and dark, no rules disabled)', async ({
    page,
  }) => {
    // Reduced motion removes the panel's fade-in, so axe measures settled colours (it would
    // otherwise sample a half-transparent panel and report a false contrast failure).
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await openMenu(page);
      const results = await new AxeBuilder({ page }).include('.shell-account-menu').analyze();
      expect(results.violations, colorScheme).toEqual([]);
    }
  });

  test('the trigger and panel are wired as a disclosure: haspopup, expanded and controls', async ({
    page,
  }) => {
    await page.goto(`/reports${CONTEXT_QUERY}`);
    await waitForHydration(page);
    const trigger = page.locator('.shell-account-trigger:visible');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).not.toHaveAttribute('aria-controls', /.+/);
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panelId = await trigger.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute('role', 'dialog');
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  });

  test('keyboard: opens, moves through the items, Escape returns focus to the trigger', async ({
    page,
  }) => {
    await page.goto(`/reports${CONTEXT_QUERY}`);
    await waitForHydration(page);
    const trigger = page.locator('.shell-account-trigger:visible');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('dialog', { name: 'Account menu' });
    await expect(menu).toBeFocused();

    // Tab order inside the menu reaches both items, in order.
    const settings = menu.getByRole('link', { name: 'Account settings' });
    const signOut = menu.getByRole('button', { name: 'Sign out' });
    await settings.focus();
    await expect(settings).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(signOut).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test.describe('Clerk sign out', () => {
  test.use({ viewport: DESKTOP });

  test('delegates sign-out to Clerk and lands on /login', async ({ page }) => {
    const { menu } = await openMenu(page, 'success');
    await menu.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');
  });

  test('a failed Clerk sign out keeps the menu and supports retry', async ({ page }) => {
    const { menu } = await openMenu(page, 'failure');
    const signOut = menu.getByRole('button', { name: 'Sign out' });
    await signOut.click();
    await expect(menu.getByRole('alert')).toHaveText('Sign out failed. Please try again.');
    await expect(signOut).toBeEnabled();
    expect(page.url()).toContain('/reports');
    await signOut.click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { testSignOutCalls: number }).testSignOutCalls),
      )
      .toBe(2);
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
      for (const item of await menu.locator('.account-menu-item').all()) {
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
