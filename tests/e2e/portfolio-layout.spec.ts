import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// Playwright transforms JSX for locator selectors. Render the actual React components through Vitest instead.
test.beforeAll(() => {
  execFileSync('pnpm', ['exec', 'vitest', 'run', 'src/modules/context/portfolio-table.test.ts'], {
    env: { ...process.env, PORTFOLIO_VISUAL_FIXTURE: '1' },
    stdio: 'pipe',
  });
});
for (const width of [1280, 390])
  for (const theme of ['dark', 'light'])
    test(`populated station overview ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route('**/api/**', (route) =>
        route.fulfill({ status: 401, json: { message: 'Synthetic visual fixture' } }),
      );
      await page.goto('/operations/daily?allStations=true');
      await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
      const markup = readFileSync('/private/tmp/shanda-portfolio-visual.html', 'utf8');
      await page.locator('#main-content').evaluate((element, html) => {
        element.innerHTML = html;
      }, markup);
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      await expect(page.getByRole('link', { name: 'Open Arcturus', exact: true })).toBeVisible();
      await expect(page.getByText('No submission').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      if (width === 1280) {
        const bounds = await page.locator('.portfolio-operations').boundingBox();
        expect(bounds!.height).toBeLessThan(480);
      }
      await page.screenshot({
        path: `/private/tmp/shanda-portfolio-${width}-${theme}.png`,
        fullPage: true,
      });
    });
