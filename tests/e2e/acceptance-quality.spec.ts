import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { mockContext, mockSettlements, STATION, TENANT } from './fixtures/data-filled';

/** F4-07 shared quality: tablet 803 px, reduced motion, 16 px phone inputs, overlay cleanup. */

const DASH_TENANT = '11111111-1111-4111-8111-111111111111';
const ENTITY = '33333333-3333-4333-8333-333333333333';
const DASH_STATION = '22222222-2222-4222-8222-222222222222';
const TODAY = `/?tenantId=${DASH_TENANT}&stationId=${DASH_STATION}`;

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function mockDashboard(page: Page) {
  await page.route('**/api/context**', (route) =>
    route.fulfill(
      json({
        data: {
          available: {
            organisations: [
              {
                id: DASH_TENANT,
                name: 'Sample organisation',
                legalEntities: [
                  {
                    id: ENTITY,
                    name: 'Sample legal entity',
                    stations: [
                      { id: DASH_STATION, code: 'BIN', name: 'Bindura', timezone: 'Africa/Harare' },
                    ],
                  },
                ],
              },
            ],
          },
          current: {
            organisationId: DASH_TENANT,
            legalEntityId: ENTITY,
            stationId: DASH_STATION,
            allStations: false,
          },
          route: {
            pathname: '/',
            policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: true },
          },
          persistedContextInvalid: false,
        },
      }),
    ),
  );
  await page.route('**/api/forecourt/operations/overview**', (route) =>
    route.fulfill(
      json({
        station: { id: DASH_STATION, code: 'BIN', name: 'Bindura', timezone: 'Africa/Harare' },
        organisation: { id: DASH_TENANT, name: 'Sample organisation' },
        currentBusinessDate: '2026-10-12',
        status: { close: 'IN_PROGRESS', approval: 'NO_REVISION' },
        shifts: [{ id: 'shift-1', state: 'OPEN' }],
      }),
    ),
  );
  await page.route('**/api/customers/summary**', (route) => route.fulfill(json({ customers: [] })));
  await page.route('**/api/reports/daily**', (route) =>
    route.fulfill(
      json({ report: 'DAILY_OPERATIONS', filters: { fromDate: '2026-10-12' }, rows: [] }),
    ),
  );
  await page.route('**/api/reports/management**', (route) =>
    route.fulfill(json({ sales: { rows: [] } })),
  );
}

test.describe('shared quality (F4-07)', () => {
  test('the dashboard fits and passes axe on a 803 px tablet in both themes', async ({ page }) => {
    await mockDashboard(page);
    await page.setViewportSize({ width: 803, height: 1024 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(TODAY);
      await expect(page.getByRole('heading', { name: 'Key figures' })).toBeVisible();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, colorScheme).toBeLessThanOrEqual(803);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, colorScheme).toEqual([]);
    }
  });

  test('reduced motion removes transitions and animations', async ({ page }) => {
    await mockDashboard(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(TODAY);
    await expect(page.locator('.today-figure').first()).toBeVisible();
    const seconds = (value: string) =>
      Math.max(
        ...value
          .split(',')
          .map((part) => parseFloat(part) * (part.trim().endsWith('ms') ? 0.001 : 1)),
      );
    const figure = await page
      .locator('.today-figure')
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(seconds(figure)).toBeLessThanOrEqual(0.001);

    await page.getByRole('button', { name: /^More/ }).click();
    const drawer = page.getByRole('dialog', { name: 'More' });
    await expect(drawer).toBeVisible();
    const motion = await drawer.evaluate((element) => {
      const panel = element.closest('.dialog-backdrop') ?? element;
      const styles = [getComputedStyle(element), getComputedStyle(panel)];
      return styles.flatMap((style) => [style.animationDuration, style.transitionDuration]);
    });
    for (const value of motion) expect(seconds(value), value).toBeLessThanOrEqual(0.001);
  });

  test('phone text controls are at least 16 px so iOS does not zoom', async ({ page }) => {
    const fontSizes = () =>
      page
        .locator(
          'input:not([type="checkbox"], [type="radio"], [type="range"], [type="file"], [type="color"], [type="hidden"]), select, textarea',
        )
        .evaluateAll((controls) =>
          controls
            .filter((control) => (control as HTMLElement).offsetParent !== null)
            .map((control) => ({
              name:
                control.getAttribute('aria-label') ?? control.id ?? control.tagName.toLowerCase(),
              size: parseFloat(getComputedStyle(control).fontSize),
            })),
        );

    await page.setViewportSize({ width: 390, height: 844 });

    // Page search: the phone header has no search button by design (one-row
    // header), so open the palette with its declared shortcut.
    await mockDashboard(page);
    await page.goto(TODAY);
    await expect(page.getByRole('heading', { name: 'Key figures' })).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('combobox', { name: 'Search pages' })).toBeVisible();
    const search = await fontSizes();
    expect(search.length).toBeGreaterThan(0);
    for (const control of search) expect(control.size, control.name).toBeGreaterThanOrEqual(16);
    await page.keyboard.press('Escape');

    // A real phone form: matching EcoCash/POS payments on Provider Settlements.
    await mockContext(page, `/stations/${STATION}/settlements`);
    await mockSettlements(page);
    await page.goto(`/stations/${STATION}/settlements?tenantId=${TENANT}`);
    await expect(page.getByLabel('Allocation amount')).toBeVisible();
    const form = await fontSizes();
    expect(form.length).toBeGreaterThanOrEqual(3);
    for (const control of form) expect(control.size, control.name).toBeGreaterThanOrEqual(16);
  });

  test('overlapping overlays restore page scroll and interactivity', async ({ page }) => {
    await mockDashboard(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(TODAY);

    await page.getByRole('button', { name: /^More/ }).click();
    await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
    await page.getByRole('button', { name: /Working at/ }).click();
    await expect(page.getByRole('dialog').last()).toBeVisible();

    for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i += 1) {
      await page.keyboard.press('Escape');
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const state = await page.evaluate(() => ({
      overflow: document.body.style.overflow,
      inert: document.querySelectorAll('[inert]').length,
      hidden: [...document.body.children].filter(
        (child) => child.getAttribute('aria-hidden') === 'true',
      ).length,
    }));
    expect(state.overflow).not.toBe('hidden');
    expect(state.inert).toBe(0);
    expect(state.hidden).toBe(0);
    // The page still takes input after both overlays are gone.
    await page.getByRole('button', { name: /^More/ }).click();
    await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
  });
});
