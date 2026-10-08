import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;

const ids = {
  organisation: 'a15e0000-0000-4000-8000-000000000001',
  legalEntity: 'a15e0000-0000-4000-8000-000000000011',
  station: 'a15e0000-0000-4000-8000-000000000021',
  actor: 'a15e0000-0000-4000-8000-000000000031',
  membership: 'a15e0000-0000-4000-8000-000000000041',
  session: 'a15e0000-0000-4000-8000-000000000051',
};
const sessionToken = 'a15-settings-session-token';

test.describe('Settings', () => {
  test('unauthenticated access goes to sign in', async ({ page }) => {
    test.skip(
      !databaseUrl || !authSecret,
      'Unauthenticated Settings E2E requires the Better Auth database configuration',
    );
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Welcome back', level: 1 })).toBeVisible();
  });

  test.describe('authorised read-only settings', () => {
    test.skip(
      !databaseUrl || !authSecret,
      'Authorised Settings E2E requires CI PostgreSQL and auth secret',
    );
    test.describe.configure({ mode: 'serial' });

    let client: Sql;

    test.beforeAll(async () => {
      client = postgres(databaseUrl!, { max: 1, prepare: false });
      await client.unsafe(`
        insert into app.tenants (id, name, slug) values
          ('${ids.organisation}', 'Settings E2E Organisation', 'settings-e2e-organisation')
          on conflict (id) do nothing;
        insert into auth."user" (id, name, email) values
          ('${ids.actor}', 'Settings E2E User', 'settings-e2e@example.test')
          on conflict (id) do nothing;
        insert into app.memberships (id, tenant_id, identity_id, status) values
          ('${ids.membership}', '${ids.organisation}', '${ids.actor}', 'ACTIVE')
          on conflict (id) do nothing;
        insert into app.legal_entities (id, tenant_id, legal_name) values
          ('${ids.legalEntity}', '${ids.organisation}', 'Settings E2E Legal Entity')
          on conflict (id) do nothing;
        insert into app.stations (id, tenant_id, legal_entity_id, code, name, timezone, status) values
          ('${ids.station}', '${ids.organisation}', '${ids.legalEntity}', 'SET-E2E', 'Settings E2E Station', 'Africa/Harare', 'ACTIVE')
          on conflict (id) do nothing;
        insert into app.membership_role_assignments
          (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values ('${ids.organisation}', '${ids.membership}', 'FINANCE', 'TENANT', null, null)
        on conflict do nothing;
        insert into auth.session
          (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
        values ('${ids.session}', '2030-01-01T00:00:00Z', '${sessionToken}', '${ids.actor}', true, now())
        on conflict (id) do update set expires_at = excluded.expires_at,
          strong_authentication_verified = true;
      `);
    });

    test.afterAll(async () => {
      await client?.end();
    });

    const sections = ['Organisation', 'Companies', 'Stations', 'Account'] as const;

    test.beforeEach(async ({ context, page }) => {
      const signedCookie = `${sessionToken}.${await makeSignature(sessionToken, authSecret!)}`;
      await context.addCookies([
        { name: 'shanda-fuel.session_token', value: signedCookie, domain: '127.0.0.1', path: '/' },
      ]);
      await page.goto(
        `/settings?tenantId=${ids.organisation}&legalEntityId=${ids.legalEntity}&stationId=${ids.station}`,
      );
      await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    });

    function content(page: Page) {
      return page.getByRole('main', { name: 'Settings' });
    }

    function sectionButton(page: Page, name: (typeof sections)[number]) {
      return page
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('button', { name, exact: true });
    }

    async function expectOnlyPressed(page: Page, active: (typeof sections)[number]) {
      for (const name of sections) {
        await expect(sectionButton(page, name)).toHaveAttribute(
          'aria-pressed',
          name === active ? 'true' : 'false',
        );
      }
    }

    test('opens on Organisation and shows the organisation name', async ({ page }) => {
      await expectOnlyPressed(page, 'Organisation');
      await expect(
        content(page).getByRole('heading', { name: 'Organisation', level: 2 }),
      ).toBeVisible();
      await expect(
        content(page).getByText('Settings E2E Organisation', { exact: true }),
      ).toBeVisible();
    });

    test('each section shows its own details once opened', async ({ page }) => {
      await sectionButton(page, 'Companies').click();
      await expectOnlyPressed(page, 'Companies');
      await expect(
        content(page).getByRole('heading', { name: 'Companies', level: 2 }),
      ).toBeVisible();
      await expect(
        content(page).getByText('Settings E2E Legal Entity', { exact: true }),
      ).toBeVisible();

      await sectionButton(page, 'Stations').click();
      await expectOnlyPressed(page, 'Stations');
      await expect(
        content(page).getByRole('heading', { name: 'Stations', level: 2 }),
      ).toBeVisible();
      await expect(content(page).getByText('Settings E2E Station', { exact: true })).toBeVisible();

      await sectionButton(page, 'Account').click();
      await expectOnlyPressed(page, 'Account');
      await expect(content(page).getByRole('heading', { name: 'Account', level: 2 })).toBeVisible();
      await expect(content(page).getByRole('heading', { name: 'Your details' })).toBeVisible();
      // The email is shown in the profile card and again in the details list.
      await expect(
        content(page).getByText('settings-e2e@example.test', { exact: true }).first(),
      ).toBeVisible();

      await sectionButton(page, 'Organisation').click();
      await expectOnlyPressed(page, 'Organisation');
      await expect(
        content(page).getByText('Settings E2E Organisation', { exact: true }),
      ).toBeVisible();
    });

    test('sections work from the keyboard and stay on the same address', async ({ page }) => {
      const url = page.url();
      await sectionButton(page, 'Organisation').focus();
      await page.keyboard.press('Tab');
      await expect(sectionButton(page, 'Companies')).toBeFocused();
      await page.keyboard.press('Enter');
      await expectOnlyPressed(page, 'Companies');
      await expect(
        content(page).getByText('Settings E2E Legal Entity', { exact: true }),
      ).toBeVisible();

      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(sectionButton(page, 'Account')).toBeFocused();
      await page.keyboard.press('Space');
      await expectOnlyPressed(page, 'Account');

      // Sections are in-page state: no #account anchor or navigation.
      expect(page.url()).toBe(url);
    });

    test('is read-only: no save action in any section', async ({ page }) => {
      for (const name of sections) {
        await sectionButton(page, name).click();
        await expect(content(page).getByRole('button', { name: /save/i })).toHaveCount(0);
      }
    });

    test('fits a 320px phone in every section and has no accessibility violations', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      for (const name of sections) {
        const button = sectionButton(page, name);
        await expect(button).toBeVisible();
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          await page.evaluate(() => window.innerWidth),
        );
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations, `accessibility violations in ${name}`).toEqual([]);
      }
    });

    test('signs out from Account', async ({ page }) => {
      await sectionButton(page, 'Account').click();
      await page.getByRole('button', { name: 'Sign out' }).click();
      // Navigation wait, not the 5s assertion window: the first sign-out call compiles its route.
      await page.waitForURL(/\/login$/);
      await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
    });
  });
});
