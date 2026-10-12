import { expect, test } from '@playwright/test';

const AUTHENTICATED_CONTEXT = {
  data: {
    available: { organisations: [] },
    current: null,
    route: {
      pathname: '/',
      policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: true },
    },
    persistedContextInvalid: false,
  },
};

test.describe('password login MFA flow', () => {
  test('holds the MFA challenge, rejects a wrong code, and establishes a session for a correct code', async ({
    page,
  }) => {
    let authenticated = false;
    let challengeCookieSeen = false;
    let contextRequests = 0;
    const submittedCodes: string[] = [];

    await page.route('**/api/auth/sign-in/email', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'set-cookie': 'shanda-fuel.two_factor=test-challenge; Path=/' },
        body: JSON.stringify({ twoFactorRedirect: true, twoFactorMethods: ['totp'] }),
      });
    });
    await page.route('**/api/auth/two-factor/verify-totp', async (route) => {
      const body = route.request().postDataJSON() as { code?: string };
      challengeCookieSeen = (route.request().headers().cookie ?? '').includes(
        'shanda-fuel.two_factor=test-challenge',
      );
      submittedCodes.push(body.code ?? '');
      if (body.code !== '123456') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'INVALID_CODE' }),
        });
        return;
      }
      authenticated = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'set-cookie': 'shanda-fuel.session_token=test-session; Path=/' },
        body: JSON.stringify({ token: 'test-session', user: { id: 'user-1' } }),
      });
    });
    await page.route('**/api/context**', async (route) => {
      contextRequests += 1;
      if (!authenticated) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'UNAUTHENTICATED' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(AUTHENTICATED_CONTEXT),
      });
    });

    await page.goto('/login');
    await page.getByLabel('Email').fill('mfa@example.test');
    await page.getByRole('textbox', { name: 'Password' }).fill('test-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('heading', { name: 'Verify your authenticator' })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify code' })).toBeVisible();

    await page.getByLabel('Authenticator code').fill('000000');
    await page.getByRole('button', { name: 'Verify code' }).click();
    await expect(page.locator('p.entry-alert')).toHaveText(
      'That authenticator code is invalid or expired. Try the current code.',
    );
    await expect(page).toHaveURL(/\/login$/);
    expect(contextRequests).toBe(0);

    await page.getByLabel('Authenticator code').fill('123456');
    await page.getByRole('button', { name: 'Verify code' }).click();
    // /workplace is compiled on first request under `next dev`; allow for the cold compile.
    await expect(page).toHaveURL(/\/workplace$/, { timeout: 30_000 });
    expect(challengeCookieSeen).toBe(true);
    expect(submittedCodes).toEqual(['000000', '123456']);
  });

  test('keeps the existing normal sign-in path for non-MFA accounts', async ({ page }) => {
    await page.route('**/api/auth/sign-in/email', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'test-session', user: { id: 'user-1' } }),
      });
    });
    await page.goto('/login');
    await page.getByLabel('Email').fill('normal@example.test');
    await page.getByRole('textbox', { name: 'Password' }).fill('test-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/workplace$/);
    await expect(page.getByRole('heading', { name: 'Verify your authenticator' })).toHaveCount(0);
  });
});
