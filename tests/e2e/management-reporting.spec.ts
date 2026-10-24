import { seedClerkIdentity, authenticateClerk } from './clerk-fixtures';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockEmptyWorkContext } from './fixtures/context-route';
import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

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
  test('unauthenticated shell explains the required organisation context', async ({ page }) => {
    await mockEmptyWorkContext(page, '/reports');
    await page.goto('/reports');
    const pageHeader = page.getByRole('region', { name: 'Page header and work context' });
    await expect(pageHeader.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(
      pageHeader.getByText('Operational Financial Position', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Choose an organisation to view reports' }),
    ).toBeVisible();
  });

  test.describe('authorized posted-facts report', () => {
    test.skip(
      !databaseUrl,
      'A10 authorized E2E requires CI PostgreSQL and Clerk development instance',
    );
    test.describe.configure({ mode: 'serial' });

    let client: Sql;

    test.beforeAll(async () => {
      client = postgres(databaseUrl!, { max: 1, prepare: false });
      await client.unsafe(`
        delete from platform.security_events
        where tenant_id = '${ids.tenant}'
          and actor_id = '${ids.actor}'
          and event_code in ('REPORT.SHARED', 'REPORT.EXPORTED');
        insert into app.tenants (id, name, slug) values
          ('${ids.tenant}', 'A10 E2E Reporting Tenant', 'a10-e2e-reporting-tenant')
          on conflict (id) do nothing;
        insert into app.users (id, name, email) values
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
      `);
      await seedClerkIdentity(client, ids.actor);
    });

    test.afterAll(async () => {
      await client?.end();
    });

    async function signIn(context: import('@playwright/test').BrowserContext) {
      await authenticateClerk(context, ids.actor);
    }

    async function gotoAndWaitForHydration(page: import('@playwright/test').Page, url: string) {
      await page.goto(url);
      await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
    }

    test('a station filter shows customer balances as unavailable and passes accessibility', async ({
      context,
      page,
    }) => {
      await signIn(context);
      await gotoAndWaitForHydration(
        page,
        `/reports/commercial?tenantId=${ids.tenant}&stations=${ids.station}`,
      );
      await page.getByRole('button', { name: 'Report filters' }).click();
      await expect(page.getByRole('dialog', { name: 'Report filters' })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /A10 E2E Main Station/ })).toBeVisible();
      await expect(page.getByText('Unavailable', { exact: true }).first()).toBeVisible();
      await expect(
        page.getByText(/Customer balances are kept for the whole organisation/),
      ).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('the Reports page lists reports, keeps filters in the link and passes accessibility', async ({
      context,
      page,
    }) => {
      await signIn(context);
      await gotoAndWaitForHydration(page, `/reports?tenantId=${ids.tenant}&period=3m`);
      await expect(page.getByRole('heading', { name: 'Available reports' })).toBeVisible();
      await expect(page.getByText('Nothing shared or exported yet.')).toBeVisible();
      await page.getByLabel('Period', { exact: true }).first().click();
      await page.getByRole('option', { name: 'Last month' }).click();
      await expect(page.getByLabel('Period', { exact: true }).first()).toHaveText('Last month');
      await page.getByRole('link', { name: 'Cash Evidence to Bank' }).click();
      await expect(page).toHaveURL(/\/reports\/cash\?.*period=3m/);
      await expect(page.getByRole('region', { name: 'Cash Evidence to Bank' })).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('row menu is keyboard operable; share copies a private link; activity shows the share', async ({
      context,
      page,
    }) => {
      await signIn(context);
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await gotoAndWaitForHydration(page, `/reports?tenantId=${ids.tenant}&period=last-month`);
      const menuButton = page.getByRole('button', { name: 'More actions for Sales & Payments' });

      // Keyboard: opens with ArrowDown, items move with arrows, Escape returns focus.
      await menuButton.focus();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: 'View' })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: 'Share private link' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(menuButton).toBeFocused();

      // Click away closes.
      await menuButton.click();
      await expect(page.getByRole('menu')).toBeVisible();
      await page.getByRole('heading', { name: 'Available reports' }).click();
      await expect(page.getByRole('menu')).toHaveCount(0);

      // Share.
      await menuButton.click();
      await page.getByRole('menuitem', { name: 'Share private link' }).click();
      await expect(page.getByText(/Private link copied/)).toBeVisible();
      const link = await page.evaluate(() => navigator.clipboard.readText());
      expect(link).toContain(`/reports/sales?tenantId=${ids.tenant}&period=last-month`);
      expect(link).not.toMatch(/token|secret|session|signature/i);

      // Recent activity lists the share.
      const rail = page.getByRole('complementary', { name: 'Browse reports' });
      await expect(rail.getByText('Sales & Payments link shared')).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    // Exporting needs a real Clerk second factor (step-up). Skipped, not passed, until the test
    // Clerk instance has one a test can answer repeatedly (after v1: a Clerk test phone number).
    test.fixme('export downloads a CSV and shows in recent activity', async ({ context, page }) => {
      await signIn(context);
      await gotoAndWaitForHydration(page, `/reports?tenantId=${ids.tenant}&period=last-month`);
      const menuButton = page.getByRole('button', { name: 'More actions for Sales & Payments' });
      const download = page.waitForEvent('download');
      await menuButton.click();
      await page.getByRole('menuitem', { name: 'Export CSV' }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(
        /^sales_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.csv$/,
      );
      const rail = page.getByRole('complementary', { name: 'Browse reports' });
      await expect(rail.getByText('Sales & Payments exported')).toBeVisible();
    });

    test('a failed report request shows an error instead of figures', async ({ context, page }) => {
      await signIn(context);
      await page.route('**/api/reports/management**', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Report could not be loaded' }),
        }),
      );
      await gotoAndWaitForHydration(page, `/reports?tenantId=${ids.tenant}`);
      await expect(page.getByText('Figures are unavailable right now.')).toBeVisible();
      await expect(page.getByText('Accounted sales')).toHaveCount(0);
    });
  });
});
