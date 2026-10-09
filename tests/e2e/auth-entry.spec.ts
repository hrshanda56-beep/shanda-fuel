import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WIDTHS = [320, 390, 430, 768, 1440];
const STATES = [
  { state: 'login', heading: 'Welcome back' },
  { state: 'invite-new', heading: "You're joining Shanda Fuel" },
  { state: 'invite-existing', heading: "You've been invited to another workspace" },
  { state: 'invite-unavailable', heading: 'This invitation is no longer available' },
  { state: 'picker', heading: 'Where are you working today?' },
  { state: 'no-workplace', heading: "You don't have a workplace yet" },
];

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`entry states (${colorScheme})`, () => {
    test.use({ colorScheme });

    for (const width of WIDTHS) {
      for (const { state, heading } of STATES) {
        for (const long of [false, true]) {
          test(`${state}${long ? ' with long names' : ''} at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            await page.goto(`/design-system/entry?state=${state}${long ? '&long=1' : ''}`);
            await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
            await expectNoSidewaysScroll(page);

            // Brand panel only on desktop; compact brand header otherwise.
            const panel = page.locator('.entry-brand');
            if (width >= 1024) await expect(panel).toBeVisible();
            else {
              // At tablet widths the brand wrapper becomes the page background rather
              // than a separate panel, so its contents remain visible via display: contents.
              await expect(panel).toHaveCSS('display', 'contents');
              await expect(panel.locator('.entry-wordmark')).toBeVisible();
            }

            // No signed-out chrome, no sign-up, no role / company pickers.
            await expect(page.getByRole('navigation')).toHaveCount(0);
            await expect(page.getByRole('link', { name: /sign up|create account/i })).toHaveCount(
              0,
            );
            await expect(page.getByRole('combobox')).toHaveCount(0);

            if (!long && width === 390) {
              const results = await new AxeBuilder({ page }).analyze();
              expect(results.violations).toEqual([]);
            }
          });
        }
      }
    }
  });
}

test.describe('sign-in behaviour', () => {
  test('redirects signed-out protected routes before rendering the product shell', async ({
    page,
    request,
  }) => {
    await page.setExtraHTTPHeaders({});
    const response = await request.get('/reports', {
      headers: { 'x-shanda-e2e-navigation-fixture': 'none' },
    });
    const html = await response.text();
    expect(response.ok()).toBe(true);
    expect(html).toContain('__next-page-redirect');
    expect(html).toContain('url=/login');
    expect(html).not.toContain('class="app-shell"');

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back', level: 1 })).toBeVisible();
  });

  test('uses 35/65 split on desktop and hides forgot-password without a reset flow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    const brand = await page.locator('.entry-brand').boundingBox();
    expect(brand!.width / 1440).toBeGreaterThan(0.33);
    expect(brand!.width / 1440).toBeLessThan(0.37);
    await expect(page.getByText('Forgot password?')).toHaveCount(0);
    await expect(page.getByLabel('Work email')).toHaveAttribute('autocomplete', 'username');
    await expect(page.getByRole('textbox', { name: 'Password' })).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
  });

  test('toggles password visibility without submitting, and Enter submits', async ({ page }) => {
    let submitted = 0;
    await page.route('**/api/auth/sign-in/email', async (route) => {
      submitted += 1;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'raw provider detail', code: 'INVALID_PASSWORD' }),
      });
    });
    await page.goto('/login');
    const password = page.locator('#password');
    await password.fill('secret-value');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    expect(submitted).toBe(0);
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(password).toHaveAttribute('type', 'password');

    await page.getByLabel('Work email').fill('someone@example.test');
    await password.press('Enter');
    const alert = page.locator('.entry-alert');
    await expect(alert).toHaveText("That email or password isn't right.");
    await expect(page.getByText('raw provider detail')).toHaveCount(0);
    await expect(password).toBeFocused();
  });

  test('rate limiting shows calm copy', async ({ page }) => {
    await page.route('**/api/auth/sign-in/email', (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', body: '{}' }),
    );
    await page.goto('/login');
    await page.getByLabel('Work email').fill('someone@example.test');
    await page.locator('#password').fill('x'.repeat(10));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.entry-alert')).toHaveText('Too many attempts. Try again shortly.');
  });

  test('invitation links fail closed and never echo the token', async ({ page }) => {
    await page.goto('/invite/SECRETTOKEN123');
    await expect(
      page.getByRole('heading', { name: 'This invitation is no longer available' }),
    ).toBeVisible();
    await expect(page.getByText('SECRETTOKEN123')).toHaveCount(0);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  });

  test('new-identity invitation validates the password and locks the email', async ({ page }) => {
    await page.goto('/design-system/entry?state=invite-new');
    await expect(page.getByLabel('Invited email')).toHaveAttribute('readonly', '');
    await page.getByLabel('Create password').fill('short');
    await page.getByLabel('Confirm password').fill('different');
    await page.getByRole('button', { name: 'Join workspace' }).click();
    await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
    await expect(page.getByText("Those passwords don't match.")).toBeVisible();
  });
});
