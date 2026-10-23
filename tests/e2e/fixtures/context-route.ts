import type { Page } from '@playwright/test';

/**
 * The synthetic navigation fixture (x-shanda-e2e-navigation-fixture) only
 * covers the server-rendered shell. The client context selector then calls
 * /api/context, which has no fixture bypass and answers 401 without a real
 * Clerk session, after which the shell redirects to /login. Specs that render
 * fixture pages without a Clerk session must therefore answer that one read.
 */
export async function mockEmptyWorkContext(page: Page, pathname = '/') {
  await page.route('**/api/context**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          available: { organisations: [] },
          current: null,
          route: {
            pathname,
            policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: true },
          },
          persistedContextInvalid: false,
        },
      }),
    });
  });
}
