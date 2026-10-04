import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
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
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
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

    test('renders authorised data, has no fake save action, and signs out', async ({
      context,
      page,
    }) => {
      const signedCookie = `${sessionToken}.${await makeSignature(sessionToken, authSecret!)}`;
      await context.addCookies([
        { name: 'shanda-fuel.session_token', value: signedCookie, domain: '127.0.0.1', path: '/' },
      ]);

      await page.goto(
        `/settings?tenantId=${ids.organisation}&legalEntityId=${ids.legalEntity}&stationId=${ids.station}`,
      );
      await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
      await expect(page.getByText('Settings E2E Organisation', { exact: true })).toBeVisible();
      await expect(page.getByText('Settings E2E Legal Entity', { exact: true })).toBeVisible();
      await expect(page.getByText('Settings E2E Station', { exact: true })).toBeVisible();
      await expect(page.getByText('settings-e2e@example.test', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /save/i })).toHaveCount(0);

      await page.setViewportSize({ width: 320, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth),
      );
      await expect(page.getByRole('link', { name: 'Account' })).toBeVisible();
      await page.getByRole('link', { name: 'Account' }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/settings\?.*#account$/);

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);

      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login$/);
    });
  });
});
