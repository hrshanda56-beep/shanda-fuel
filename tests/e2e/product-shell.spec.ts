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
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
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

  test('planned areas open the work-in-progress dialog instead of navigating', async ({ page }) => {
    await page.goto('/reports');
    await waitForHydration(page);
    const customers = sidebarNav(page).getByRole('button', { name: /Customers/ });

    await customers.click();
    const dialog = page.getByRole('dialog', { name: 'Customers is in progress' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Nothing has been changed.');
    await expect(page).toHaveURL(/\/reports$/);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(customers).toBeFocused();
  });

  test('Help and Notifications explain that they are unavailable', async ({ page }) => {
    await page.goto('/foundation');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Help' }).click();
    const helpDialog = page.getByRole('dialog', { name: 'Help is in progress' });
    await expect(helpDialog).toBeVisible();
    await expect(helpDialog).toContainText('Help content is not available yet.');
    await page.keyboard.press('Escape');
    await expect(helpDialog).toBeHidden();

    await page.getByRole('button', { name: 'Notifications' }).click();
    const notificationsDialog = page.getByRole('dialog', {
      name: 'Notifications is in progress',
    });
    await expect(notificationsDialog).toBeVisible();
    await expect(notificationsDialog).toContainText('Notifications are not available yet.');
  });

  test('station areas explain station selection until a station is in context', async ({
    page,
  }) => {
    await page.goto('/reports');
    await waitForHydration(page);
    await sidebarNav(page).getByRole('button', { name: 'Cash and banking' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Station selection is in progress' }),
    ).toBeVisible();
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

  test('theme control overrides the system preference and persists', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/reports');
    await waitForHydration(page);
    const control = page.locator('.shell-sidebar').getByRole('group', { name: 'Theme' });
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
    await page
      .locator('.shell-sidebar')
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

  test('a planned area from the menu shows one dialog and returns focus to the menu button', async ({
    page,
  }) => {
    await page.goto('/reports');
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('button', { name: /Settings/ })
      .click();

    await expect(page.getByRole('dialog', { name: 'Settings is in progress' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
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
