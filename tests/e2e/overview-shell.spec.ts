import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** The overview stays truthful until live reporting data is available. */

test.beforeEach(async ({ page }) => {
  await page.route('**/api/context**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          available: { organisations: [] },
          current: null,
          route: {
            pathname: '/',
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

const TENANT = '11111111-1111-4111-8111-111111111111';
const STATION = '22222222-2222-4222-8222-222222222222';

function operationsOverview(close: string, approval = 'NO_REVISION') {
  return {
    station: { id: STATION, code: 'BIN', name: 'Bindura', timezone: 'Africa/Harare' },
    organisation: { id: TENANT, name: 'Triumph Energy' },
    currentBusinessDate: '2026-10-08',
    status: { close, approval },
    shifts: [{ id: 'shift-1', state: 'OPEN' }],
  };
}

async function mockToday(
  page: Page,
  options: { operations?: { status: number; body: unknown }; customers?: unknown[] } = {},
) {
  await page.route('**/api/forecourt/operations/overview**', async (route) => {
    const { status, body } = options.operations ?? {
      status: 200,
      body: operationsOverview('IN_PROGRESS'),
    };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/customers/summary**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ customers: options.customers ?? [] }),
    });
  });
}

const TODAY = `/?tenantId=${TENANT}&stationId=${STATION}`;

test('today asks for a station instead of showing empty figures', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(page.getByText('Choose a work context', { exact: false })).toBeVisible();
  await expect(page.locator('.today-figures')).toHaveCount(0);
  await expect(page.locator('.card')).toHaveCount(0);
});

test('key figures show real counts and honest placeholders', async ({ page }) => {
  await mockToday(page, {
    customers: [{ status: 'ACTIVE' }, { status: 'ACTIVE' }, { status: 'SUSPENDED' }],
  });
  await page.goto(TODAY);
  const figures = page.locator('.today-figures');
  await expect(figures.locator('.today-figure', { hasText: 'Shifts open' })).toContainText('1');
  await expect(figures.locator('.today-figure', { hasText: 'Active customers' })).toContainText(
    '2',
  );
  await expect(figures.locator('.today-figure', { hasText: 'Sales today' })).toContainText(
    'Not connected yet',
  );
  await expect(page.getByRole('heading', { name: 'Sales performance Statistic' })).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);
});

test('today shows the station day and calm attention list', async ({ page }) => {
  await mockToday(page);
  await page.goto(TODAY);

  const row = page.getByRole('link', { name: /Bindura/ });
  await expect(row).toContainText('In progress');
  await expect(row).toContainText('1 shift · 1 open');
  await expect(row).toHaveAttribute('href', new RegExp(`/operations/daily\\?tenantId=${TENANT}`));
  await expect(page.getByText('Nothing needs attention.')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);
});

test('today surfaces blocked operations and suspended customers', async ({ page }) => {
  await mockToday(page, {
    operations: { status: 200, body: operationsOverview('BLOCKED', 'RETURNED') },
    customers: [{ status: 'ACTIVE' }, { status: 'SUSPENDED' }, { status: 'SUSPENDED' }],
  });
  await page.goto(TODAY);

  const attention = page
    .getByRole('region', { name: 'Needs attention' })
    .or(page.locator('section[aria-labelledby="today-attention-heading"]'));
  await expect(attention.getByRole('link', { name: /Bindura is blocked/ })).toContainText(
    'Returned for changes',
  );
  await expect(attention.getByRole('link', { name: /2 customers are suspended/ })).toBeVisible();
});

test('today explains missing access and failures in plain words', async ({ page }) => {
  await mockToday(page, { operations: { status: 403, body: { error: 'FORBIDDEN' } } });
  await page.goto(TODAY);
  await expect(
    page.getByText('You don’t have access to daily operations for this station.'),
  ).toBeVisible();

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await mockToday(page, {
    operations: { status: 500, body: { message: 'Daily operations could not be loaded.' } },
  });
  await page.goto(TODAY);
  await expect(page.locator('.state-error')).toContainText('Daily operations unavailable');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('owner shell keeps grouped navigation, collapse, and global search', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
  const nav = sidebar.getByRole('navigation', { name: 'Primary navigation' });

  await expect(nav.getByRole('link', { name: 'Today', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Operations' })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
  await expect(sidebar.getByRole('searchbox')).toHaveCount(0);

  await page.getByRole('button', { name: 'Search pages' }).click();
  await expect(page.getByRole('combobox', { name: 'Search pages' })).toBeFocused();
  await page.keyboard.press('Escape');

  await sidebar
    .getByRole('button', { name: 'Collapse sidebar' })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'collapsed');
});

test('overview remains accessible at desktop and phone widths', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }
});

test.describe('today hardening', () => {
  test('recovers when Try again succeeds after a failure', async ({ page }) => {
    let failing = true;
    await mockToday(page);
    await page.route('**/api/forecourt/operations/overview**', async (route) => {
      if (failing) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(operationsOverview('OPEN')),
      });
    });
    await page.goto(TODAY);
    const retry = page.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeVisible();
    failing = false;
    await retry.click();
    await expect(page.getByRole('link', { name: /Bindura/ })).toContainText('Open');
    await expect(page.locator('.state-error')).toHaveCount(0);
  });

  test('survives a dropped connection and unreadable responses without crashing', async ({
    page,
  }) => {
    await mockToday(page);
    await page.route('**/api/forecourt/operations/overview**', (route) => route.abort('failed'));
    await page.route('**/api/customers/summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '<html>oops' }),
    );
    await page.goto(TODAY);
    await expect(page.locator('.state-error')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.getByText('NaN', { exact: true })).toHaveCount(0);
    await expect(page.getByText('undefined', { exact: true })).toHaveCount(0);
  });

  test('never shows a zero or an empty message while still loading', async ({ page }) => {
    await mockToday(page);
    await page.route('**/api/forecourt/operations/overview**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(operationsOverview('OPEN')),
      });
    });
    await page.goto(TODAY);
    await expect(page.getByText('Nothing needs attention.')).toHaveCount(0);
    await expect(page.getByText(/customers? (is|are) suspended/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Bindura/ })).toBeVisible();
  });

  test('customer access denied does not hide the station day', async ({ page }) => {
    await mockToday(page);
    await page.route('**/api/customers/summary**', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }),
    );
    await page.goto(TODAY);
    await expect(page.getByRole('link', { name: /Bindura/ })).toBeVisible();
    await expect(page.locator('.state-error')).toHaveCount(0);
  });

  for (const width of [320, 390, 430, 820, 1024, 1440]) {
    test(`has no sideways scroll at ${width}px`, async ({ page }) => {
      await mockToday(page, { customers: [{ status: 'SUSPENDED' }] });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(TODAY);
      await expect(page.getByRole('link', { name: /Bindura/ })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('phone More drawer: keyboard, focus and axe', async ({ page }) => {
    await mockToday(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(TODAY);
    const more = page.getByRole('button', { name: 'More' });
    await more.click();
    const drawer = page.getByRole('dialog', { name: 'More' });
    await expect(drawer).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    // Focus stays inside the drawer while tabbing.
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      );
      expect(inside).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(more).toBeFocused();
  });

  test('tablet rail: every group opens the full menu and all links are reachable', async ({
    page,
  }) => {
    await mockToday(page);
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto(TODAY);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-shell-mode', 'tablet');
    const rail = page.locator('.shell-sidebar');
    await expect(rail.getByRole('link').first()).toBeVisible();
    await rail.getByRole('button', { name: 'Finance' }).click();
    const drawer = page.getByRole('dialog', { name: 'More' });
    await expect(drawer.getByRole('link', { name: 'Customers', exact: true })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('dashboard passes axe at desktop and phone with live content', async ({ page }) => {
    await mockToday(page, {
      operations: { status: 200, body: operationsOverview('EXCEPTION', 'RETURNED') },
      customers: [{ status: 'SUSPENDED' }],
    });
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(TODAY);
      await expect(page.getByRole('link', { name: /Bindura/ }).first()).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    }
  });

  test('dashboard, drawer and context pill pass axe in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await mockToday(page, {
      operations: { status: 200, body: operationsOverview('BLOCKED', 'RETURNED') },
      customers: [{ status: 'SUSPENDED' }],
    });
    for (const size of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(TODAY);
      await expect(page.getByRole('link', { name: /Bindura/ }).first()).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});
