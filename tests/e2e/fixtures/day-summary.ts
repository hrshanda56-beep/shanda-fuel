import { expect, type Page } from '@playwright/test';

/**
 * Someone who runs the shift lands on one question at a time (#253). The full day summary
 * (shifts, alerts, day details) is behind "View today's summary". Opens it, retrying the tap in
 * case it lands before the page has finished loading in the browser.
 */
export async function openDaySummary(page: Page): Promise<void> {
  const link = page.getByRole('button', { name: 'View today’s summary' });
  const back = page.getByRole('button', { name: 'Back to the next step' });
  await expect(link.or(back)).toBeVisible();
  await expect(async () => {
    if (await link.isVisible()) await link.click();
    await expect(back).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}
