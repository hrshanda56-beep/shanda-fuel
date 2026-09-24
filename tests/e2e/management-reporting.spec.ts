import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;

const ids = {
  tenant: 'a10e0000-0000-4000-8000-000000000001',
  legal: 'a10e0000-0000-4000-8000-000000000011',
  station: 'a10e0000-0000-4000-8000-000000000021',
  actor: 'a10e0000-0000-4000-8000-000000000031',
  membership: 'a10e0000-0000-4000-8000-000000000041',
  session: 'a10e0000-0000-4000-8000-000000000051',
};
const sessionToken = 'a10-e2e-management-session-token';

test.describe('management reporting surface', () => {
  test('unauthenticated shell explains the required tenant context', async ({ page }) => {
    await page.goto('/reports');
    await expect(
      page.getByRole('heading', { name: 'Operational financial position' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tenant context required' })).toBeVisible();
  });

  test.describe('authorized posted-facts report', () => {
    test.skip(
      !databaseUrl || !authSecret,
      'A10 authorized E2E requires CI PostgreSQL and auth secret',
    );
    test.describe.configure({ mode: 'serial' });

    let client: Sql;

    test.beforeAll(async () => {
      client = postgres(databaseUrl!, { max: 1, prepare: false });
      await client.unsafe(`
        insert into app.tenants (id, name, slug) values
          ('${ids.tenant}', 'A10 E2E Reporting Tenant', 'a10-e2e-reporting-tenant')
          on conflict (id) do nothing;
        insert into auth."user" (id, name, email) values
          ('${ids.actor}', 'A10 E2E Finance', 'a10-e2e-finance@example.test')
          on conflict (id) do nothing;
        insert into app.memberships (id, tenant_id, identity_id, status) values
          ('${ids.membership}', '${ids.tenant}', '${ids.actor}', 'ACTIVE')
          on conflict (id) do nothing;
        insert into app.legal_entities (id, tenant_id, legal_name) values
          ('${ids.legal}', '${ids.tenant}', 'A10 Legal')
          on conflict (id) do nothing;
        insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
          ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'A10E2E', 'A10 E2E Main Station', 'ACTIVE')
          on conflict (id) do nothing;
        insert into app.membership_role_assignments
          (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
        values ('${ids.tenant}', '${ids.membership}', 'FINANCE', 'TENANT', null, null)
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

    test('authorized finance user can open the posted report and filters are accessible', async ({
      context,
      page,
    }) => {
      const signedCookie = `${sessionToken}.${await makeSignature(sessionToken, authSecret!)}`;
      await context.addCookies([
        { name: 'shanda-fuel.session_token', value: signedCookie, domain: '127.0.0.1', path: '/' },
      ]);
      await page.goto(`/reports?tenantId=${ids.tenant}`);
      await expect(page.getByRole('heading', { name: 'Report filters' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Refresh report' })).toBeVisible();
      await expect(page.getByText('POSTED', { exact: true })).toBeVisible();
      await page.getByLabel('Station').selectOption(ids.station);
      await page.getByRole('button', { name: 'Refresh report' }).click();
      await expect(page.getByText('Unavailable', { exact: true }).first()).toBeVisible();
      await expect(
        page.getByText(/unavailable at station scope because A8 balances/),
      ).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  });
});
