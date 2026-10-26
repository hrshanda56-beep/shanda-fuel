import { expect, test } from '@playwright/test';

/**
 * Explicit release gate for weak-network verification. It is opt-in because the
 * authenticated environment and production-like data are release inputs, not
 * safe defaults for every local browser run.
 */
test.describe('slow-3G performance budget', () => {
  test.skip(!process.env.PERFORMANCE_E2E, 'Set PERFORMANCE_E2E=1 for the release performance gate');

  test('loads the reporting shell without exceeding the initial JavaScript budget', async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 400,
      downloadThroughput: (500 * 1024) / 8,
      uploadThroughput: (500 * 1024) / 8,
    });

    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Shanda Fuel/i);

    const transferredJavaScript = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter(
          (entry): entry is PerformanceResourceTiming =>
            entry instanceof PerformanceResourceTiming && entry.initiatorType === 'script',
        )
        .reduce((total, entry) => total + Math.max(entry.transferSize, entry.encodedBodySize), 0),
    );

    // This is a warning-level budget for the shell's initial JS, not a claim
    // that every authenticated data route has the same bundle size.
    expect(transferredJavaScript, 'initial JavaScript transfer').toBeLessThanOrEqual(200 * 1024);
  });
});
