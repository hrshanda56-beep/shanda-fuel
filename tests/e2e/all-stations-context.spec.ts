import { test, expect } from '@playwright/test';
import { contextRoutePolicy } from '../../src/modules/context/routes';
const tenant = '11111111-1111-4111-8111-111111111111';
const entity = '22222222-2222-4222-8222-222222222222';
const station = '33333333-3333-4333-8333-333333333333';
for (const width of [390, 1280])
  test(`All → station → All remains available at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    let selection: {
      organisationId: string;
      legalEntityId?: string;
      stationId?: string;
      allStations: boolean;
    } = { organisationId: tenant, allStations: true };
    let refreshFails = false;
    const posts: Array<{ pathname: string }> = [];
    await page.route('**/api/context**', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        posts.push(body);
        selection = body.selection;
        return route.fulfill({ json: { data: { current: selection } } });
      }
      if (refreshFails)
        return route.fulfill({ status: 503, json: { message: 'Synthetic connection failure' } });
      const pathname = new URL(route.request().url()).searchParams.get('pathname') ?? '/reports';
      return route.fulfill({
        json: {
          data: {
            available: {
              organisations: [
                {
                  id: tenant,
                  name: 'Owner',
                  legalEntities: [
                    {
                      id: entity,
                      name: 'Entity',
                      stations: [
                        { id: station, code: 'A', name: 'Alpha station', timezone: 'UTC' },
                      ],
                    },
                  ],
                },
              ],
            },
            current: selection,
            route: { pathname, policy: contextRoutePolicy(pathname) },
            persistedContextInvalid: false,
          },
        },
      });
    });
    await page.route('**/api/reports/management**', (route) =>
      route.fulfill({ status: 500, json: { message: 'Unavailable in navigation fixture' } }),
    );
    await page.goto(`/reports?tenantId=${tenant}&allStations=true`);
    const trigger = page
      .getByRole('region', { name: 'Page header and work context' })
      .getByRole('button', { name: /^Work context/ });
    await expect(page.locator('.shell-context-pill')).toHaveAttribute('aria-label', /All stations/);
    await trigger.click();
    await page
      .getByRole('dialog', { name: 'Switch station' })
      .getByRole('button', { name: /Alpha station/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`stationId=${station}`));
    await expect(trigger).toHaveAttribute('aria-label', /Alpha station/);
    await trigger.click();
    await page
      .getByRole('dialog', { name: 'Switch station' })
      .getByRole('button', { name: /All stations/ })
      .click();
    await expect(page).toHaveURL(/allStations=true/);
    expect(new URL(page.url()).searchParams.has('stationId')).toBe(false);
    await expect(page.locator('.shell-context-pill')).toHaveAttribute('aria-label', /All stations/);
    expect(posts.at(-1)?.pathname).toBe('/reports');
    // The original regression: station-required screens hid All stations entirely.
    selection = {
      organisationId: tenant,
      legalEntityId: entity,
      stationId: station,
      allStations: false,
    };
    await page.goto(`/stations/${station}/cash?tenantId=${tenant}&legalEntityId=${entity}`);
    await expect(trigger).toHaveAttribute('aria-label', /Alpha station/);
    const stationNavigation = page.locator(width < 700 ? '.shell-mobile-nav' : '.shell-sidebar');
    await stationNavigation.getByRole('link', { name: 'Customers', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`stationId=${station}`));
    await expect(trigger).toHaveAttribute('aria-label', /Alpha station/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(trigger).toHaveAttribute('aria-label', /Alpha station/);
    expect(new URL(page.url()).searchParams.get('stationId')).toBe(station);
    await page.goto(`/stations/${station}/cash?tenantId=${tenant}&legalEntityId=${entity}`);
    await trigger.click();
    await page
      .getByRole('dialog', { name: 'Switch station' })
      .getByRole('button', { name: /All stations/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/cash\\?tenantId=${tenant}&allStations=true`));
    expect(posts.at(-1)?.pathname).toBe('/cash');
    const nav = page.locator(width < 700 ? '.shell-mobile-nav' : '.shell-sidebar');
    await nav.getByRole('link', { name: 'Customers', exact: true }).click();
    await expect(page).toHaveURL(/allStations=true/);
    await expect(page.locator('.shell-context-pill')).toHaveAttribute('aria-label', /All stations/);
    await page.goto(`/cash?tenantId=${tenant}&allStations=true`);

    await expect(page.locator('.shell-context-pill')).toHaveAttribute('aria-label', /All stations/);
    await trigger.click();
    await page
      .getByRole('dialog', { name: 'Switch station' })
      .getByRole('button', { name: /Alpha station/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`/stations/${station}/cash\\?`));
    await expect(trigger).toHaveAttribute('aria-label', /Alpha station/);
    await trigger.click();
    await page
      .getByRole('dialog', { name: 'Switch station' })
      .getByRole('button', { name: /All stations/ })
      .click();
    await expect(page.locator('.shell-context-pill')).toHaveAttribute('aria-label', /All stations/);

    const navigation =
      width < 700 ? page.locator('.shell-mobile-nav') : page.locator('.shell-sidebar');
    const links = await navigation
      .locator('a[href]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')!));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(href).toContain('allStations=true');
      expect(href).not.toContain('stationId=');
    }
    refreshFails = true;
    await page.evaluate(() =>
      window.history.pushState(
        null,
        '',
        `${window.location.pathname}${window.location.search}&retryProbe=1`,
      ),
    );
    await trigger.click();
    await expect(page.getByRole('heading', { name: 'Could not refresh stations' })).toBeVisible();
    await expect(page.locator('.shell-context-pill')).toHaveAttribute('aria-label', /All stations/);
    refreshFails = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(
      page
        .getByRole('dialog', { name: 'Switch station' })
        .getByRole('button', { name: /All stations/ }),
    ).toBeVisible();
    await expect(page.locator('.shell-context-pill')).toHaveAttribute('aria-label', /All stations/);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
