import { expect, test, type Locator, type Page } from '@playwright/test';

/*
 * The work context (organisation, legal entity, station) must survive phone navigation:
 * the header switcher, the bottom dock, the More drawer, the Account settings link and a
 * station switch. Database-free; /api/context is answered by the test.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const ENTITY = '22222222-2222-4222-8222-222222222222';
const STATION_A = '33333333-3333-4333-8333-333333333333';
const STATION_B = '44444444-4444-4444-8444-444444444444';
const QUERY = `tenantId=${ORG}&legalEntityId=${ENTITY}&stationId=${STATION_A}`;

const station = (id: string, code: string, name: string) => ({
  id,
  code,
  name,
  timezone: 'Africa/Harare',
});

async function arrange(page: Page) {
  let current = STATION_A;
  await page.route('**/api/context**', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { selection?: { stationId?: string } };
      if (body.selection?.stationId) current = body.selection.stationId;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            current: {
              organisationId: ORG,
              legalEntityId: ENTITY,
              stationId: current,
              allStations: false,
            },
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
                id: ORG,
                name: 'Sample organisation',
                legalEntities: [
                  {
                    id: ENTITY,
                    name: 'Trading entity',
                    stations: [
                      station(STATION_A, 'ALPHA', 'Alpha station'),
                      station(STATION_B, 'BRAVO', 'Bravo station'),
                    ],
                  },
                ],
              },
            ],
          },
          current: {
            organisationId: ORG,
            legalEntityId: ENTITY,
            stationId: current,
            allStations: false,
          },
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
        body: JSON.stringify({ message: 'Dependency unavailable in context test' }),
      }),
    );
  }
}

async function ready(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
}

/** Every product link must carry the organisation, the legal entity and the station. */
function expectCarriesContext(hrefs: string[], stationId: string, where: string) {
  expect(hrefs.length, `${where}: links found`).toBeGreaterThan(0);
  for (const href of hrefs) {
    const url = new URL(href, 'http://local.test');
    const stationInPath = url.pathname.match(/^\/stations\/([^/]+)/)?.[1];
    expect(url.searchParams.get('tenantId'), `${where}: ${href} tenantId`).toBe(ORG);
    expect(url.searchParams.get('legalEntityId'), `${where}: ${href} legalEntityId`).toBe(ENTITY);
    expect(stationInPath ?? url.searchParams.get('stationId'), `${where}: ${href} station`).toBe(
      stationId,
    );
  }
}

const hrefsOf = (links: Locator) =>
  links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
const dockLinks = (page: Page) => page.locator('.shell-mobile-nav a[href^="/"]');

for (const width of [390, 320]) {
  test.describe(`phone ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test('header switcher, dock, More drawer and Account settings all keep the station', async ({
      page,
    }) => {
      await arrange(page);
      await ready(page, `/reports?${QUERY}`);

      // The header names the station you are working in.
      const switcher = page
        .getByRole('region', { name: 'Page header and work context' })
        .getByRole('button', { name: /^Work context/ });
      await expect(switcher).toHaveAttribute('aria-label', /Alpha station/);

      expectCarriesContext(await hrefsOf(dockLinks(page)), STATION_A, 'bottom dock');

      await page.locator('.shell-mobile-nav-more').click();
      const more = page.getByRole('dialog', { name: 'More' });
      await expect(more).toBeVisible();
      expectCarriesContext(await hrefsOf(more.getByRole('link')), STATION_A, 'More drawer');
      await page.keyboard.press('Escape');
      await expect(more).toBeHidden();

      await page.locator('.shell-account-trigger:visible').click();
      const account = page.getByRole('dialog', { name: 'Account menu' });
      const settings = account.getByRole('link', { name: 'Account settings' });
      expectCarriesContext(
        [(await settings.getAttribute('href')) ?? ''],
        STATION_A,
        'Account settings',
      );
    });

    test('moving through the dock keeps the context in the address and the header', async ({
      page,
    }) => {
      await arrange(page);
      await ready(page, `/reports?${QUERY}`);
      const dock = page.getByRole('navigation', { name: 'Mobile navigation' });
      // Second item: on a 320px phone the Next.js dev badge (dev server only) covers the first one.
      const target = dock.getByRole('link').nth(1);
      const label = (await target.textContent())?.trim() ?? '';
      await target.click();
      await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
      const url = new URL(page.url());
      const stationInPath = url.pathname.match(/^\/stations\/([^/]+)/)?.[1];
      expect(url.searchParams.get('tenantId'), `after tapping ${label}`).toBe(ORG);
      expect(stationInPath ?? url.searchParams.get('stationId'), `after tapping ${label}`).toBe(
        STATION_A,
      );
      await expect(
        page
          .getByRole('region', { name: 'Page header and work context' })
          .getByRole('button', { name: /^Work context/ }),
      ).toHaveAttribute('aria-label', /Alpha station/);
    });

    test('switching station on the phone changes only the station', async ({ page }) => {
      await arrange(page);
      await ready(page, `/reports?${QUERY}`);
      await page
        .getByRole('region', { name: 'Page header and work context' })
        .getByRole('button', { name: /^Work context/ })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Switch station' });
      await dialog.getByRole('button', { name: /Bravo station/ }).click();
      await expect(page).toHaveURL(new RegExp(`stationId=${STATION_B}`));
      const url = new URL(page.url());
      expect(url.searchParams.get('tenantId')).toBe(ORG);
      expect(url.searchParams.get('legalEntityId')).toBe(ENTITY);
      await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
      // The dock follows the address; allow the client navigation to settle, then require it.
      await expect
        .poll(
          async () =>
            (await hrefsOf(dockLinks(page))).every(
              (href) =>
                href.includes(`stationId=${STATION_B}`) || href.includes(`/stations/${STATION_B}`),
            ),
          {
            timeout: 10_000,
            message: 'dock links follow the new station',
          },
        )
        .toBe(true);
      expectCarriesContext(await hrefsOf(dockLinks(page)), STATION_B, 'dock after switch');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });
  });
}

test.describe('desktop sidebar', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the sidebar follows a station switch too (regression: links kept the old station)', async ({
    page,
  }) => {
    await arrange(page);
    await ready(page, `/reports?${QUERY}`);
    const sidebarLinks = page.locator('.shell-sidebar a[href^="/"]');
    expectCarriesContext(await hrefsOf(sidebarLinks), STATION_A, 'sidebar before switch');
    await page
      .getByRole('region', { name: 'Page header and work context' })
      .getByRole('button', { name: /^Work context/ })
      .click();
    await page
      .getByRole('dialog', { name: 'Switch station' })
      .getByRole('button', { name: /Bravo station/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`stationId=${STATION_B}`));
    await expect
      .poll(
        async () =>
          (await hrefsOf(sidebarLinks)).every(
            (href) =>
              href.includes(`stationId=${STATION_B}`) || href.includes(`/stations/${STATION_B}`),
          ),
        { timeout: 10_000, message: 'sidebar links follow the new station' },
      )
      .toBe(true);
  });
});
