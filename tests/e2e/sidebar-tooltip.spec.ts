import { expect, test } from '@playwright/test';

for (const width of [1113, 1213, 1440]) {
  test(`rail labels escape clipping on hover and focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 774 });
    await page.route('**/api/**', (route) =>
      route.request().url().includes('/api/clerk')
        ? route.continue()
        : route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
    );
    await page.goto('/reports?tenantId=t-1&allStations=true');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
    if (width >= 1200) {
      await page.locator('.shell-sidebar .nav-row').filter({ hasText: 'Reports' }).first().hover();
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    }
    await expect
      .poll(async () => (await page.locator('.shell-sidebar').boundingBox())!.width)
      .toBeLessThanOrEqual(80);
    const row = page.locator('.shell-sidebar .nav-row').filter({ hasText: 'Reports' }).first();
    await expect
      .poll(async () =>
        row.evaluate((el) => {
          const row = el.getBoundingClientRect();
          const frame = el.closest('.shell-sidebar')!.getBoundingClientRect();
          const region = el.closest('.shell-sidebar-nav-region')!.getBoundingClientRect();
          return Math.min(
            row.left - frame.left,
            frame.right - row.right,
            row.left - region.left,
            region.right - row.right,
          );
        }),
      )
      .toBeGreaterThanOrEqual(3);
    await row.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveText('Reports');
    const box = await tooltip.boundingBox();
    const rail = await page.locator('.shell-sidebar').boundingBox();
    expect(box!.x).toBeGreaterThan(rail!.x + rail!.width);
    expect(box!.x + box!.width).toBeLessThan(width);
    expect(
      await tooltip.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return (
          document
            .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            ?.closest('.shell-sidebar') === null
        );
      }),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await page.mouse.move(width - 10, 20);
    await row.focus();
    await expect(tooltip).toHaveText('Reports');
    await row.blur();
    await expect(tooltip).toHaveCount(0);
  });
}
