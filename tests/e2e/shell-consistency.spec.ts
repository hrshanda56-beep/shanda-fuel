import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const VIEWPORTS = [
  { name: 'mobile-small', width: 320, height: 800 },
  { name: 'mobile', width: 468, height: 844 },
  { name: 'tablet', width: 982, height: 800 },
  { name: 'desktop', width: 1482, height: 900 },
] as const;

const HEADER_VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 800 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function prepareShell(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto('/reports');
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

test.describe('shared shell consistency', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} has no horizontal overflow`, async ({ page }) => {
      await prepareShell(page, viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
    });
  }

  test('desktop keeps the footer reachable while navigation is the scroll region', async ({
    page,
  }) => {
    await prepareShell(page, { width: 1482, height: 900 });
    const sidebar = page.locator('.shell-sidebar');
    const navRegion = sidebar.locator('.shell-sidebar-nav-region');
    const footer = sidebar.locator('.shell-sidebar-footer');

    await expect(sidebar).toBeVisible();
    await expect(page.locator('.shell-topbar')).toBeHidden();
    await expect(navRegion).toBeVisible();
    expect(await navRegion.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
    const footerBox = await footer.boundingBox();
    expect(footerBox).not.toBeNull();
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(900);
    await expect(sidebar.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
  });

  test('tablet uses a persistent icon rail', async ({ page }) => {
    await prepareShell(page, { width: 982, height: 800 });
    const sidebar = page.locator('.shell-sidebar');
    const nav = sidebar.getByRole('navigation', { name: 'Primary navigation' });

    await expect(page.locator('.app-shell')).toHaveAttribute('data-shell-mode', 'tablet');
    await expect(sidebar).toBeVisible();
    await expect(page.locator('.shell-topbar')).toBeHidden();
    await expect(nav.getByRole('button', { name: 'Operations' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Operations' }).locator('.nav-label')).toHaveCSS(
      'opacity',
      '0',
    );
    await expect(sidebar.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();

    const account = page.locator('.shell-account-trigger:visible');
    await expect(account).toHaveAttribute('aria-label', 'Account');
    await expect(account).toHaveCSS('width', '44px');
    await expect(account.locator('.shell-account-trigger-text')).toBeHidden();
    await expect(account.locator('.shell-account-chevron')).toBeHidden();
  });

  test('mobile has one compact header and a working navigation drawer', async ({ page }) => {
    await prepareShell(page, { width: 468, height: 844 });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-shell-mode', 'mobile');
    await expect(page.locator('.shell-sidebar')).toBeHidden();
    await expect(page.locator('.shell-topbar')).toBeVisible();
    await expect(page.locator('.shell-topbar .shell-brand')).toHaveCount(1);
    await expect(page.locator('.shell-mobile-brand')).toHaveCount(0);
    await expect(page.locator('.shell-topbar kbd:visible')).toHaveCount(0);
    await expect(page.locator('.shell-account-trigger:visible')).toHaveCount(1);

    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Menu' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    await drawer.getByRole('button', { name: 'Finance' }).click();
    await expect(drawer.getByRole('link', { name: 'Customers', exact: true })).toHaveAttribute(
      'href',
      '/customers',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  });

  test('long work-context names wrap without creating horizontal overflow', async ({ page }) => {
    await page.route('**/api/context**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            available: {
              organisations: [
                {
                  id: 'tenant-long',
                  name: 'A deliberately long authorised organisation name for mobile review',
                  legalEntities: [
                    {
                      id: 'entity-long',
                      name: 'A deliberately long legal entity name for mobile review',
                      stations: [
                        {
                          id: 'station-long',
                          code: 'HRE-LONG',
                          name: 'A deliberately long station name for mobile review',
                          timezone: 'Africa/Harare',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            current: {
              organisationId: 'tenant-long',
              legalEntityId: 'entity-long',
              stationId: 'station-long',
              allStations: false,
            },
            route: {
              pathname: '/reports',
              policy: { legalEntity: 'required', station: 'required', allStationsAllowed: false },
            },
            persistedContextInvalid: false,
          },
        }),
      });
    });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/reports');

    const context = page.getByRole('group', { name: 'Work context' });
    await expect(context).toContainText('A deliberately long authorised organisation name');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    const box = await context.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  });

  test('Customers is represented while Settings remains represented', async ({ page }) => {
    await prepareShell(page, { width: 1482, height: 900 });
    const sidebar = page.locator('.shell-sidebar');
    await sidebar.getByRole('button', { name: 'Finance' }).click();
    await expect(sidebar.getByRole('link', { name: 'Customers', exact: true })).toHaveAttribute(
      'href',
      '/customers',
    );
    await expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );

    await page.getByRole('button', { name: 'Search pages' }).click();
    const palette = page.getByRole('dialog', { name: 'Search' });
    await expect(palette.getByRole('combobox', { name: 'Search pages' })).toBeFocused();
    await expect(palette).toContainText('Settings');
    await expect(palette).toContainText('Customers');
    await expect(page.getByText('Search anything', { exact: false })).toHaveCount(0);
  });

  test('uses one visible account control and one theme-control system', async ({ page }) => {
    await prepareShell(page, { width: 1482, height: 900 });
    await expect(page.locator('.shell-account-trigger:visible')).toHaveCount(1);
    await expect(page.locator('.theme-control:visible')).toHaveCount(0);

    const account = page.locator('.shell-account-trigger:visible');
    await account.click();
    const menu = page.getByRole('menu', { name: 'Account menu' });
    await expect(menu).toBeVisible();
    await expect(page.locator('.theme-control:visible')).toHaveCount(1);
    await expect(menu).not.toContainText('Current user');
    await expect(menu).not.toContainText('CU');

    const theme = page.locator('.theme-control:visible');
    await theme.getByRole('radio', { name: 'Dark' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.goto('/suppliers');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const restoredAccount = page.locator('.shell-account-trigger:visible');
    await restoredAccount.click();
    await page.keyboard.press('Escape');
    await expect(restoredAccount).toBeFocused();
  });

  test('shared shell chrome passes accessibility checks', async ({ page }) => {
    await prepareShell(page, { width: 1482, height: 900 });
    const results = await new AxeBuilder({ page })
      .include('.shell-sidebar')
      .include('.shell-header')
      .analyze();
    expect(results.violations).toEqual([]);
  });

  for (const viewport of HEADER_VIEWPORTS) {
    test(`${viewport.name} keeps page headings in the shared header`, async ({ page }) => {
      await page.setViewportSize(viewport);
      for (const [path, title] of [
        ['/', 'Dashboard'],
        ['/operations/daily', 'Daily operations'],
        ['/reports', 'Reports'],
        ['/inventory', 'Inventory'],
      ] as const) {
        await page.goto(path);
        const shell = page.locator('.app-shell');
        await expect(shell).toHaveCount(1);
        await expect(shell).toHaveAttribute('data-hydrated', 'true');
        await expect(shell.locator('.shell-header h1')).toHaveText(title);
        await expect(shell.locator('.shell-sheet h1')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
      }
    });
  }
});
