import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Overlays fade and rise in; axe must sample their settled colours, not a frame mid-fade. */
async function animationsSettled(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getComputedTiming().endTime === Infinity,
      ),
  );
}

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
  options: {
    operations?: { status: number; body: unknown };
    customers?: unknown[];
    daily?: unknown[];
    sales?: unknown[];
  } = {},
) {
  await page.route('**/api/reports/daily**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        report: 'DAILY_OPERATIONS',
        filters: { fromDate: '2026-10-08' },
        rows: options.daily ?? [],
      }),
    });
  });
  await page.route('**/api/reports/management**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ sales: { rows: options.sales ?? [] } }),
    });
  });
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

function dailyRow(overrides: Record<string, unknown> = {}) {
  return {
    reportDate: '2026-10-08',
    stationId: STATION,
    stationCode: 'BIN',
    litresSold: '1284.4',
    salesValue: '2484.12',
    cashVariance: '-30.85',
    inventoryVariance: '0',
    customerCreditEvidence: '100',
    prepaidEvidence: '0',
    reconciliationIds: ['rec-1'],
    ...overrides,
  };
}

test('key figures say when no approved report exists yet', async ({ page }) => {
  await mockToday(page);
  await page.goto(TODAY);
  const figures = page.locator('.today-figures');
  for (const label of ['Sales today', 'Litres sold', 'Cash variance', 'Account sales']) {
    await expect(figures.locator('.today-figure', { hasText: label })).toContainText(
      'No approved report yet',
    );
  }
  const note = page.locator('.today-figures-note');
  await expect(note).toContainText('Approved figures for 08 Oct 2026');
  await expect(note).toContainText('Expected cash and stock variance are not available yet.');
  await expect(page.getByRole('heading', { name: 'Sales performance Litres' })).toBeVisible();
  await expect(page.getByText('No approved sales in this period yet.')).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);
});

test('key figures show approved totals with signed variances', async ({ page }) => {
  await mockToday(page, { daily: [dailyRow()] });
  await page.goto(TODAY);
  const figures = page.locator('.today-figures');
  await expect(figures.locator('.today-figure', { hasText: 'Sales today' })).toContainText(
    'USD 2,484.12',
  );
  await expect(figures.locator('.today-figure', { hasText: 'Litres sold' })).toContainText(
    '1,284 L',
  );
  const cash = figures.locator('.today-figure', { hasText: 'Cash variance' });
  await expect(cash).toContainText('−USD 30.85');
  await expect(cash).toContainText('Cash short');
  await expect(figures.locator('.today-figure', { hasText: 'Account sales' })).toContainText(
    'USD 100.00',
  );
});

test('daily figures are requested for the selected station and the server business date', async ({
  page,
}) => {
  await mockToday(page, { daily: [dailyRow()] });
  const request = page.waitForRequest('**/api/reports/daily**');
  await page.goto(TODAY);
  const url = new URL((await request).url());
  expect(url.searchParams.get('tenantId')).toBe(TENANT);
  expect(url.searchParams.get('stationIds')).toBe(STATION);
  // The server resolves "today" in the station's business timezone.
  expect(url.searchParams.has('fromDate')).toBe(false);
  expect(url.searchParams.has('toDate')).toBe(false);
});

test('an approved zero is shown as zero, unlike a day with no approved report', async ({
  page,
}) => {
  await mockToday(page, {
    daily: [dailyRow({ salesValue: '0.0000', litresSold: '0', cashVariance: '0.0000' })],
  });
  await page.goto(TODAY);
  const figures = page.locator('.today-figures');
  await expect(figures.locator('.today-figure', { hasText: 'Sales today' })).toContainText(
    'USD 0.00',
  );
  await expect(figures.locator('.today-figure', { hasText: 'Cash variance' })).toContainText(
    'No cash variance',
  );
  await expect(figures).not.toContainText('No approved report yet');
  await expect(figures).not.toContainText('Stock variance');
});

test('figures fit their cards without splitting a number, at every width', async ({ page }) => {
  await mockToday(page, {
    daily: [dailyRow({ salesValue: '120000', cashVariance: '-12345.67' })],
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(TODAY);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
  // Exercise responsive reflow on the same rendered data, including live resizing.
  for (const width of [320, 375, 1024, 1280, 1360, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.today-figure', { hasText: 'Sales today' })).toContainText(
      'USD 120,000.00',
    );
    const overflow = await page.locator('.today-figure-value').evaluateAll((values) =>
      values
        .map((value) => {
          const range = document.createRange();
          range.selectNodeContents(value);
          const widest = Math.max(...[...range.getClientRects()].map((rect) => rect.width));
          return { text: value.textContent, widest, box: value.clientWidth };
        })
        .filter(({ widest, box }) => widest > box + 1),
    );
    expect(overflow, `width ${width}`).toEqual([]);
  }
});

test('the sales chart is also available as a keyboard-operable table', async ({ page }) => {
  const harare = (offsetDays: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare' }).format(
      new Date(Date.now() - offsetDays * 86_400_000),
    );
  const today = harare(0);
  const yesterday = harare(1);
  await mockToday(page, {
    sales: [
      { businessDate: yesterday, productName: 'Diesel 50ppm', litres: '578.400' },
      { businessDate: yesterday, productName: 'ULP 95', litres: '706.000' },
      { businessDate: today, productName: 'Diesel 50ppm', litres: '10' },
    ],
  });
  await page.goto(TODAY);
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '7D' }).click();

  const summary = page.locator('.today-chart-table > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  const table = page.getByRole('table', { name: /Litres sold, 7D, from approved reports only/ });
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText([
    'Business date',
    'Litres sold',
    'Diesel 50ppm',
    'ULP 95',
  ]);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(7);
  // Oldest day: no approved report, said in words rather than shown as 0.
  await expect(rows.first()).toContainText('No approved report');
  await expect(rows.first()).not.toContainText('0 L');
  // Yesterday: exact totals per configured product.
  await expect(rows.nth(5)).toContainText('1,284 L');
  await expect(rows.nth(5)).toContainText('578 L');
  await expect(rows.nth(5)).toContainText('706 L');
  // Today: a product without an approved row is unavailable, not zero.
  await expect(rows.nth(6)).toContainText('10 L');
  await expect(rows.nth(6).locator('td').last()).toContainText('No approved figure');

  const results = await new AxeBuilder({ page }).include('.today-chart-table').analyze();
  expect(results.violations).toEqual([]);
});

test('the phone dock gives More the same tap target as the other tabs', async ({ page }) => {
  await mockToday(page);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(TODAY);
    const dock = page.getByRole('navigation', { name: 'Mobile navigation' });
    const sizes = await dock
      .locator('a, button')
      .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
    expect(sizes.length, `width ${width}`).toBeGreaterThan(1);
    const more = sizes[sizes.length - 1] ?? 0;
    expect(more, `width ${width}`).toBeGreaterThanOrEqual(44);
    for (const size of sizes)
      expect(Math.abs(size - more), `width ${width}`).toBeLessThanOrEqual(1);
  }
});

test('a cash shortage stays readable on its pastel card in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockToday(page, { daily: [dailyRow()] });
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(TODAY);
    const value = page.locator('.today-figure[data-tone="short"] .today-figure-value');
    await expect(value).toHaveText('−USD 30.85');
    await expect(value).toHaveCSS('color', 'rgb(143, 29, 29)');
  }
});

test('rows without an approved reconciliation are not shown as zero sales', async ({ page }) => {
  await mockToday(page, {
    daily: [
      dailyRow({ salesValue: '0', litresSold: '0', cashVariance: '0', reconciliationIds: [] }),
    ],
  });
  await page.goto(TODAY);
  await expect(page.locator('.today-figure', { hasText: 'Sales today' })).toContainText(
    'No approved report yet',
  );
});

test('sales trend offers business-day ranges and no hourly view', async ({ page }) => {
  await mockToday(page);
  await page.goto(TODAY);
  const periods = page.getByRole('group', { name: 'Period' });
  for (const option of ['7D', '30D', '90D', '12M']) {
    await expect(periods.getByRole('button', { name: option })).toBeVisible();
  }
  await expect(periods.getByRole('button', { name: '24H' })).toHaveCount(0);
  await expect(periods.getByRole('button', { name: '30D' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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

    await animationsSettled(page);
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
    const drawer = page.getByRole('dialog', { name: 'Finance' });
    await expect(drawer.getByRole('link', { name: 'Customers', exact: true })).toBeVisible();
    await animationsSettled(page);
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
    await animationsSettled(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});
