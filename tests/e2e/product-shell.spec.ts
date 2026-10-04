import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/*
 * Product Shell: grouped navigation, current-route indication, collapsible
 * groups and rail, work-in-progress destinations, theme control, the phone
 * drawer, and shell-level route states. Presentation only; no backend data.
 */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

function sidebarNav(page: Page) {
  return page.locator('.shell-sidebar').getByRole('navigation', { name: 'Primary navigation' });
}

// Client handlers attach at hydration; the shell marks itself once they are live.
async function waitForHydration(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
}

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
    await page.route(`**/api/${endpoint}**`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Dependency unavailable in shell test' }),
      });
    });
  }
});

test.describe('desktop sidebar', () => {
  test.use({ viewport: DESKTOP });

  test('groups navigation by business area and marks the current route', async ({ page }) => {
    await page.goto('/operations/daily');
    const nav = sidebarNav(page);

    await expect(nav.getByRole('link', { name: 'Today' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Operations' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(nav.getByRole('button', { name: 'Finance' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Suppliers' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reports' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Daily operations' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test('collapses a group accessibly and remembers it', async ({ page }) => {
    await page.goto('/reports');
    await waitForHydration(page);
    const nav = sidebarNav(page);
    const finance = nav.getByRole('button', { name: 'Finance' });

    await finance.click();
    await expect(finance).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.getByRole('button', { name: 'Cash and banking' })).toBeHidden();

    await page.reload();
    await expect(sidebarNav(page).getByRole('button', { name: 'Finance' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await sidebarNav(page).getByRole('button', { name: 'Finance' }).click();
    await expect(sidebarNav(page).getByRole('button', { name: 'Cash and banking' })).toBeVisible();
  });

  test('collapses to an icon rail that persists without a flash', async ({ page }) => {
    await page.goto('/reports');
    await waitForHydration(page);
    await page
      .getByRole('button', { name: 'Collapse sidebar' })
      .evaluate((button) => (button as HTMLButtonElement).click());
    await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'collapsed');

    await page.reload({ waitUntil: 'commit' });
    // Applied by the pre-paint script, before React hydrates.
    await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'collapsed');
    const nav = sidebarNav(page);
    await expect(nav.getByRole('link', { name: 'Reports' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Scoped to shell chrome: page bodies are reviewed in the Golden Path work.
    const results = await new AxeBuilder({ page })
      .include('.shell-sidebar')
      .include('.shell-header')
      .analyze();
    expect(results.violations).toEqual([]);

    // A group in the rail reopens the full sidebar with that group expanded.
    await waitForHydration(page);
    await nav.getByRole('button', { name: 'Operations' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-sidebar', 'collapsed');
    await expect(nav.getByRole('link', { name: 'Daily operations' })).toBeVisible();
  });

  test('Settings stays represented while its page is not integrated', async ({ page }) => {
    await page.goto('/reports');
    await waitForHydration(page);
    const settings = sidebarNav(page).getByRole('button', { name: 'Settings' });

    await settings.click();
    const dialog = page.getByRole('dialog', { name: 'Settings is in progress' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Nothing has been changed.');
    await expect(page).toHaveURL(/\/reports$/);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(settings).toBeFocused();
  });

  test('Help and Notifications are not active-looking shell controls', async ({ page }) => {
    await page.goto('/foundation');
    await waitForHydration(page);
    await expect(page.getByRole('button', { name: 'Help' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Notifications' })).toHaveCount(0);
  });

  test('station areas open the shared context selector instead of a WIP dialog', async ({
    page,
  }) => {
    await page.goto('/reports');
    await waitForHydration(page);
    await sidebarNav(page).getByRole('button', { name: 'Cash and banking' }).click();
    await expect(page.getByRole('dialog', { name: 'Select work context' })).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Station selection is in progress' }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.goto('/stations/station-1/settlements?tenantId=tenant-1');
    await waitForHydration(page);
    const nav = sidebarNav(page);
    await expect(nav.getByRole('link', { name: 'Cash and banking' })).toHaveAttribute(
      'href',
      '/stations/station-1/cash?tenantId=tenant-1',
    );
    await expect(nav.getByRole('link', { name: 'Reports' })).toHaveAttribute(
      'href',
      '/reports?tenantId=tenant-1&stationId=station-1',
    );
    await expect(nav.getByRole('link', { name: 'Provider settlements' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('renders authorised context options and switches a cross-station route', async ({
    page,
  }) => {
    const organisationId = '11111111-1111-4111-8111-111111111111';
    const legalEntityId = '22222222-2222-4222-8222-222222222222';
    const stationId = '33333333-3333-4333-8333-333333333333';
    await page.route('**/api/context**', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              current: { organisationId, legalEntityId, stationId, allStations: false },
            },
          }),
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            available: {
              organisations: [
                {
                  id: organisationId,
                  name: 'Authorised organisation',
                  legalEntities: [
                    {
                      id: legalEntityId,
                      name: 'Trading entity',
                      stations: [
                        {
                          id: stationId,
                          code: 'STA',
                          name: 'Authorised station',
                          timezone: 'Africa/Harare',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            current: { organisationId, allStations: true },
            route: {
              pathname: '/reports',
              policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: true },
            },
            persistedContextInvalid: false,
          },
        }),
      });
    });

    await page.goto('/reports');
    await waitForHydration(page);
    await page.getByRole('button', { name: /Change work context/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Select work context' });
    await expect(dialog).toContainText('Authorised organisation');
    await expect(dialog.locator('option', { hasText: 'All stations' })).toBeAttached();
    await expect(dialog.locator('option', { hasText: 'Authorised station' })).toBeAttached();

    await dialog.getByLabel('Station (optional)').selectOption(stationId);
    await dialog.getByRole('button', { name: 'Use this context' }).click();
    await expect(page).toHaveURL(
      `/reports?tenantId=${organisationId}&legalEntityId=${legalEntityId}&stationId=${stationId}`,
    );
  });

  test('context selector remains usable at 320px without horizontal overflow', async ({ page }) => {
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
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto('/reports');
    await waitForHydration(page);
    const trigger = page.getByRole('button', { name: /Change work context/ });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Select work context' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth),
    );
  });

  test('theme control overrides the system preference and persists', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/reports');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Account' }).click();
    const control = page.getByRole('menu', { name: 'Account menu' }).getByRole('group', {
      name: 'Theme',
    });
    await expect(control.getByRole('radio', { name: /System/ })).toBeChecked();

    await control.getByRole('radio', { name: 'Dark' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Scoped to shell chrome: page bodies are reviewed in the Golden Path work.
    const results = await new AxeBuilder({ page })
      .include('.shell-sidebar')
      .include('.shell-header')
      .analyze();
    expect(results.violations).toEqual([]);

    await waitForHydration(page);
    await page.getByRole('button', { name: 'Account' }).click();
    await page
      .getByRole('menu', { name: 'Account menu' })
      .getByRole('group', { name: 'Theme' })
      .getByRole('radio', { name: /System/ })
      .check();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  });

  test('unknown routes render a not-found state inside the shell', async ({ page }) => {
    const response = await page.goto('/no-such-page');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible();
    await expect(sidebarNav(page)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to Today', exact: true })).toHaveAttribute(
      'href',
      '/',
    );
  });
});

test.describe('phone navigation', () => {
  test.use({ viewport: PHONE });

  test('opens the grouped menu from the keyboard and returns focus', async ({ page }) => {
    await page.goto('/reports');
    await waitForHydration(page);
    const menuButton = page.getByRole('button', { name: 'Open menu' });

    await menuButton.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toBeVisible();
    // The page behind the drawer is inert, so assert on the element directly.
    await expect(page.locator('.shell-menu-button')).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('link', { name: 'Reports' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(results.violations).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(menuButton).toBeFocused();
  });

  test('navigating from the menu closes it and lands on the destination', async ({ page }) => {
    await page.goto('/reports');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('link', { name: 'Suppliers' })
      .click();

    await expect(page).toHaveURL(/\/suppliers$/);
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
  });

  test('Settings links to the real route from the menu', async ({ page }) => {
    await page.goto('/reports');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Settings' }),
    ).toHaveAttribute('href', '/settings');
  });
});

test('sign-in page keeps its frame and passes accessibility checks on tablet', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  const card = await page.locator('.auth-card').boundingBox();
  expect(card?.x).toBeGreaterThan(16);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
