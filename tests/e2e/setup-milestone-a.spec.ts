import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';

import { seedActiveStepUp } from '../integration/auth-session-fixtures';

const databaseUrl = process.env.DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;

const run = randomUUID().slice(0, 8);
const ids = {
  organisation: randomUUID(),
  legalEntity: randomUUID(),
  station: randomUUID(),
  activeStation: randomUUID(),
  actor: randomUUID(),
  membership: randomUUID(),
  session: randomUUID(),
};
const sessionToken = `setup-e2e-${run}`;

const main = (page: Page) => page.getByRole('main', { name: 'Settings' });

test.describe('Station setup (owner self-service)', () => {
  test.skip(!databaseUrl || !authSecret, 'Setup E2E requires PostgreSQL and the auth secret');
  test.describe.configure({ mode: 'serial' });

  let client: Sql;

  test.beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.organisation}', 'Setup E2E Organisation', 'setup-e2e-${run}');
      insert into auth."user" (id, name, email) values
        ('${ids.actor}', 'Setup E2E Owner', 'setup-e2e-${run}@example.test');
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.organisation}', '${ids.actor}', 'ACTIVE');
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legalEntity}', '${ids.organisation}', 'Setup E2E Legal Entity');
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, timezone, status) values
        ('${ids.station}', '${ids.organisation}', '${ids.legalEntity}', 'S${run}', 'Setup E2E Station', 'Africa/Harare', 'ONBOARDING'),
        ('${ids.activeStation}', '${ids.organisation}', '${ids.legalEntity}', 'A${run}', 'Setup E2E Live Station', 'Africa/Harare', 'ACTIVE');
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values ('${ids.organisation}', '${ids.membership}', 'OWNER', 'TENANT', null, null);
      insert into auth.session
        (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at)
      values ('${ids.session}', '2030-01-01T00:00:00Z', '${sessionToken}', '${ids.actor}', true, now());
    `);
    await seedActiveStepUp(client, ids.session, ids.organisation);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test.beforeEach(async ({ context, page }) => {
    const signedCookie = `${sessionToken}.${await makeSignature(sessionToken, authSecret!)}`;
    await context.addCookies([
      { name: 'shanda-fuel.session_token', value: signedCookie, domain: '127.0.0.1', path: '/' },
    ]);
    await page.goto(
      `/settings?tenantId=${ids.organisation}&legalEntityId=${ids.legalEntity}&stationId=${ids.activeStation}`,
    );
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Station setup', exact: true })
      .click();
    // Stations being onboarded are not in the normal station switcher; setup lists them.
    await main(page)
      .getByLabel('Station')
      .selectOption({ label: 'Setup E2E Station (being set up)' });
    await expect(page.getByRole('heading', { name: 'Fuel products', level: 3 })).toBeVisible({
      timeout: 60_000,
    });
  });

  async function fillAndSubmit(
    page: Page,
    dialogName: string,
    fill: (dialog: ReturnType<Page['getByRole']>) => Promise<void>,
    submit: string,
  ) {
    const dialog = page.getByRole('dialog', { name: dialogName });
    await expect(dialog).toBeVisible();
    await fill(dialog);
    await dialog.getByRole('button', { name: submit, exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  }

  test('starts as "Not entered" with blockers, never a zero', async ({ page }) => {
    for (const heading of ['Fuel products', 'Tanks', 'Pumps and nozzles', 'Shift templates']) {
      await expect(page.getByRole('heading', { name: heading, level: 3 })).toBeVisible();
    }
    await expect(main(page).getByText('Not entered').first()).toBeVisible();
    await expect(
      page.getByText('No tank is entered, so fuel deliveries cannot be received.').first(),
    ).toBeVisible();
    await expect(main(page).getByText(/^0(\.0+)? ?L?$/)).toHaveCount(0);
  });

  test('owner enters product, tank, pump, nozzle and shift', async ({ page }) => {
    await main(page).getByRole('button', { name: 'Add product' }).click();
    await fillAndSubmit(
      page,
      'Add fuel product',
      async (dialog) => {
        await dialog.getByLabel('Name').fill('Diesel');
        await dialog.getByLabel('Code').fill('DSL');
      },
      'Add product',
    );
    await expect(main(page).getByRole('list', { name: 'Fuel products' })).toContainText('Diesel');

    await main(page).getByRole('button', { name: 'Add tank' }).click();
    await fillAndSubmit(
      page,
      'Add tank',
      async (dialog) => {
        await dialog.getByLabel('Tank name or number').fill('T1');
        await dialog.getByLabel('Product').selectOption({ label: 'Diesel' });
        await dialog.getByLabel('Capacity (litres)').fill('20000');
        await dialog.getByLabel('Reorder level, optional (litres)').fill('3000');
      },
      'Add tank',
    );
    const tanks = main(page).getByRole('list', { name: 'Tanks' });
    await expect(tanks).toContainText('Tank T1');
    await expect(tanks).toContainText('20,000 L');
    // Variance was left blank: shown as not entered, not as zero.
    await expect(tanks).toContainText('Allowed variance');
    await expect(tanks).toContainText('Not entered');

    await main(page).getByRole('button', { name: 'Add pump' }).click();
    await fillAndSubmit(
      page,
      'Add pump',
      async (dialog) => {
        await dialog.getByLabel('Pump number').fill('1');
      },
      'Add pump',
    );
    await main(page).getByRole('button', { name: 'Add nozzle' }).click();
    await fillAndSubmit(
      page,
      'Add nozzle',
      async (dialog) => {
        await dialog.getByLabel('Pump').selectOption({ label: 'Pump 1' });
        await dialog.getByLabel('Nozzle number').fill('1');
        await dialog.getByLabel('Product').selectOption({ label: 'Diesel' });
        await dialog.getByLabel('Meter serial number').fill(`SN-${run}`);
      },
      'Add nozzle',
    );
    await expect(main(page).getByRole('list', { name: 'Pumps and nozzles' })).toContainText(
      `meter SN-${run}`,
    );

    await main(page).getByRole('button', { name: 'Add shift' }).click();
    await fillAndSubmit(
      page,
      'Add shift',
      async (dialog) => {
        await dialog.getByLabel('Name').fill('Day shift');
        await dialog.getByLabel('Code').fill('DAY');
        await dialog.getByLabel('Start time').fill('06:00');
        await dialog.getByLabel('Length (minutes)').fill('720');
      },
      'Add shift',
    );
    await expect(main(page).getByRole('list', { name: 'Shift templates' })).toContainText(
      '06:00 · 12 h',
    );

    // A duplicate is refused with a plain message and nothing is added.
    await main(page).getByRole('button', { name: 'Add product' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add fuel product' });
    await dialog.getByLabel('Name').fill('Diesel again');
    await dialog.getByLabel('Code').fill('DSL');
    await dialog.getByRole('button', { name: 'Add product', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('already exists');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('owner sets a price and it waits for a second approver', async ({ page }) => {
    await expect(main(page).getByRole('list', { name: 'Current selling prices' })).toContainText(
      'Not entered',
    );
    await main(page).getByRole('button', { name: 'Set a price' }).click();
    await fillAndSubmit(
      page,
      'Set a price',
      async (dialog) => {
        await dialog.getByLabel('Product').selectOption({ label: 'Diesel' });
        await dialog.getByLabel('Price per litre').fill('1.45');
        await dialog.getByLabel('Currency code').fill('USD');
        await dialog.getByLabel('Effective from').fill('2026-10-13T06:00');
      },
      'Submit for approval',
    );
    const changes = main(page).getByRole('list', { name: 'Price changes in progress' });
    await expect(changes).toContainText('Diesel · 1.45 USD');
    await expect(changes).toContainText('Waiting for approval');
    // Not in use yet, so the station is still blocked from trading on diesel.
    await expect(page.getByText(/No active selling price for Diesel/)).toBeVisible();
  });

  for (const width of [320, 390, 768, 1024]) {
    test(`fits ${width}px with no sideways scroll and no accessibility violations`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('heading', { name: 'Selling prices', level: 3 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth),
      );
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, `accessibility violations at ${width}px`).toEqual([]);

      // The form sheet is also usable and accessible at this width.
      await main(page).getByRole('button', { name: 'Add tank' }).click();
      const dialog = page.getByRole('dialog', { name: 'Add tank' });
      await expect(dialog).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth),
      );
      const formResults = await new AxeBuilder({ page }).analyze();
      expect(formResults.violations, `form accessibility violations at ${width}px`).toEqual([]);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    });
  }
});
