import { seedClerkIdentity, authenticateClerk } from './clerk-fixtures';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

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
      !databaseUrl,
      'Unauthenticated Settings E2E requires the Better Auth database configuration',
    );
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Welcome back', level: 1 })).toBeVisible({
      timeout: 20_000,
    });
  });

  test.describe('authorised read-only settings', () => {
    test.skip(
      !databaseUrl,
      'Authorised Settings E2E requires CI PostgreSQL and Clerk development instance',
    );
    test.describe.configure({ mode: 'serial' });

    let client: Sql;

    test.beforeAll(async () => {
      client = postgres(databaseUrl!, { max: 1, prepare: false });
      await client.unsafe(`
        insert into app.tenants (id, name, slug) values
          ('${ids.organisation}', 'Settings E2E Organisation', 'settings-e2e-organisation')
          on conflict (id) do nothing;
        insert into app.users (id, name, email) values
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
      `);
      await seedClerkIdentity(client, ids.actor);
    });

    test.afterAll(async () => {
      await client?.end();
    });

    const sections = ['Organisation', 'Companies', 'Stations', 'Account'] as const;

    test.beforeEach(async ({ context, page }) => {
      await authenticateClerk(context, ids.actor);
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
      await expect(content(page).getByRole('heading', { name: 'Profile', level: 3 })).toBeVisible();
      await expect(content(page).getByText('Name', { exact: true })).toBeVisible();
      await expect(content(page).getByText('Email', { exact: true })).toBeVisible();
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

      // Which sections sit between Companies and Account depends on the person's access, so tab
      // forward through them in order until Account has focus.
      for (let step = 0; step < sections.length + 12; step += 1) {
        await page.keyboard.press('Tab');
        if (await sectionButton(page, 'Account').evaluate((el) => el === document.activeElement))
          break;
      }
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
        // On a phone the section tabs collapse into a "Settings section" menu.
        await page.locator('summary[aria-label^="Settings section:"]').click();
        await page
          .getByRole('navigation', { name: 'Choose Settings section' })
          .getByRole('button', { name, exact: true })
          .click();
        await expect(page.locator(`summary[aria-label="Settings section: ${name}"]`)).toBeVisible();
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
      await expect(page.getByRole('heading', { name: 'Welcome back', level: 1 })).toBeVisible({
        timeout: 20_000,
      });
    });
  });
});
