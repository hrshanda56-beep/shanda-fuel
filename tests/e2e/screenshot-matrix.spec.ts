import { expect, test } from '@playwright/test';

import {
  mockContext,
  mockOverview,
  mockSettlements,
  STATION,
  TENANT,
} from './fixtures/data-filled';

/**
 * Screenshot matrix for the F4-08 handoff. Runs only when SCREENSHOT_DIR is
 * set, e.g. SCREENSHOT_DIR=…/F0_outputs/evidence/screenshots. All data is
 * synthetic: the dashboard uses the development-only /dev-preview SAMPLE
 * data, the other screens use contract-shaped mocks.
 */
const dir = process.env.SCREENSHOT_DIR;
test.skip(!dir, 'Set SCREENSHOT_DIR to capture the screenshot matrix');

const widths = [390, 803, 1440] as const;
const themes = ['light', 'dark'] as const;

const screens = [
  {
    name: 'dashboard',
    url: '/dev-preview?scenario=normal',
    ready: 'Key figures',
    mock: async () => {},
  },
  {
    name: 'daily-operations',
    url: `/operations/daily?tenantId=${TENANT}&stationId=${STATION}`,
    ready: 'Shifts',
    mock: async (page: import('@playwright/test').Page) => {
      await mockContext(page, '/operations/daily');
      await mockOverview(page);
    },
  },
  {
    name: 'reconciliations',
    url: `/stations/${STATION}/reconciliations?tenantId=${TENANT}`,
    // The list card heading, not the page title (which renders while loading).
    ready: 'Shift reconciliations',
    mock: async (page: import('@playwright/test').Page) => {
      await mockContext(page, `/stations/${STATION}/reconciliations`);
      await mockOverview(page);
    },
  },
  {
    name: 'provider-settlements',
    url: `/stations/${STATION}/settlements?tenantId=${TENANT}`,
    ready: 'Settled by provider',
    mock: async (page: import('@playwright/test').Page) => {
      await mockContext(page, `/stations/${STATION}/settlements`);
      await mockSettlements(page);
    },
  },
];

for (const screen of screens) {
  test(`screenshots: ${screen.name}`, async ({ page }) => {
    // Six document loads and captures share this budget. Traces show a cold
    // first document taking ~25s before the remaining five captures begin.
    test.setTimeout(90_000);
    await screen.mock(page);
    for (const width of widths) {
      for (const colorScheme of themes) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme });
        await page.goto(screen.url);
        await page.locator('.app-shell[data-hydrated="true"]').waitFor({ state: 'attached' });
        await expect(
          page.getByRole('heading', { name: screen.ready, exact: true }).first(),
        ).toBeVisible();
        if (screen.name === 'reconciliations') {
          await expect(page.getByText('Needs attention', { exact: true })).toBeVisible();
        }
        // The page title can match before data arrives: wait until nothing is
        // still loading, so a capture never shows a loading state.
        await expect(page.getByText(/^Loading\b/)).toHaveCount(0);
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
        // Let transitions (e.g. the active navigation pill) finish so repeated
        // captures are identical when nothing changed.
        await page.waitForFunction(() =>
          document
            .getAnimations()
            .every(
              (animation) =>
                animation.playState !== 'running' ||
                animation.effect?.getComputedTiming().endTime === Infinity,
            ),
        );
        await page.screenshot({
          path: `${dir}/${screen.name}-${width}-${colorScheme}.png`,
          fullPage: true,
        });
      }
    }
  });
}
