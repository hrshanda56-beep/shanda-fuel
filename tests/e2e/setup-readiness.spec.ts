import { seedClerkIdentity, authenticateClerk } from './clerk-fixtures';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

const ids = {
  organisation: 'e2e70000-0000-4000-8000-000000000001',
  legalEntity: 'e2e70000-0000-4000-8000-000000000011',
  stationReady: 'e2e70000-0000-4000-8000-000000000021',
  stationBare: 'e2e70000-0000-4000-8000-000000000022',
  actor: 'e2e70000-0000-4000-8000-000000000031',
  membership: 'e2e70000-0000-4000-8000-000000000041',
  session: 'e2e70000-0000-4000-8000-000000000051',
  product: 'e2e70000-0000-4000-8000-000000000061',
  pump: 'e2e70000-0000-4000-8000-000000000071',
  price: 'e2e70000-0000-4000-8000-000000000081',
};
const sessionToken = 'setup-readiness-session-token';
const WIDTHS = [320, 390, 768, 1024, 1440] as const;

test.describe('Setup readiness and payment setup', () => {
  test.skip(!databaseUrl, 'Setup E2E requires CI PostgreSQL and the Clerk development instance');
  test.describe.configure({ mode: 'serial' });

  let client: Sql;

  test.beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      -- Re-runnable: provider setup is created by the tests themselves.
      delete from app.provider_accounts where tenant_id = '${ids.organisation}';
      delete from app.payment_providers where tenant_id = '${ids.organisation}';
      insert into app.tenants (id, name, slug) values
        ('${ids.organisation}', 'Setup E2E Organisation', 'setup-e2e-organisation')
        on conflict (id) do nothing;
      insert into app.users (id, name, email) values
        ('${ids.actor}', 'Setup E2E Admin', 'setup-e2e@example.test')
        on conflict (id) do nothing;
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.organisation}', '${ids.actor}', 'ACTIVE')
        on conflict (id) do nothing;
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legalEntity}', '${ids.organisation}', 'Setup E2E Legal Entity')
        on conflict (id) do nothing;
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, timezone, status) values
        ('${ids.stationReady}', '${ids.organisation}', '${ids.legalEntity}', 'SUP-RDY', 'Setup Ready Station', 'Africa/Harare', 'ACTIVE'),
        ('${ids.stationBare}', '${ids.organisation}', '${ids.legalEntity}', 'SUP-BARE', 'Setup Bare Station', 'Africa/Harare', 'ONBOARDING')
        on conflict (id) do nothing;
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values ('${ids.organisation}', '${ids.membership}', 'ADMINISTRATOR', 'TENANT', null, null)
      on conflict do nothing;
      insert into app.products (id, tenant_id, code, name) values
        ('${ids.product}', '${ids.organisation}', 'SUP-ULP', 'Setup Unleaded')
        on conflict (id) do nothing;
      insert into app.selling_prices (id, tenant_id, station_id, product_id, effective_from, unit_price, currency, state, requested_by)
        values ('${ids.price}', '${ids.organisation}', '${ids.stationReady}', '${ids.product}', now() - interval '1 day', 1.500000, 'USD', 'DRAFT', '${ids.membership}')
        on conflict (id) do nothing;
      update app.selling_prices set state = 'PENDING_APPROVAL' where id = '${ids.price}' and state = 'DRAFT';
      update app.selling_prices set state = 'APPROVED' where id = '${ids.price}' and state = 'PENDING_APPROVAL';
      update app.selling_prices set state = 'PENDING_STATION_ACTIVATION' where id = '${ids.price}' and state = 'APPROVED';
      update app.selling_prices set state = 'BOUNDARIES_IN_PROGRESS' where id = '${ids.price}' and state = 'PENDING_STATION_ACTIVATION';
      update app.selling_prices set state = 'ACTIVE' where id = '${ids.price}' and state = 'BOUNDARIES_IN_PROGRESS';
      insert into app.tanks (tenant_id, station_id, code, product_id, capacity_litres, acceptable_variance_litres, created_by, updated_by)
        values ('${ids.organisation}', '${ids.stationReady}', 'SUP-T1', '${ids.product}', 10000, 25, '${ids.membership}', '${ids.membership}')
        on conflict do nothing;
      insert into app.pumps (id, tenant_id, station_id, number) values ('${ids.pump}', '${ids.organisation}', '${ids.stationReady}', 'P1')
        on conflict (id) do nothing;
      insert into app.nozzles (tenant_id, station_id, pump_id, number, product_id)
        values ('${ids.organisation}', '${ids.stationReady}', '${ids.pump}', 'N1', '${ids.product}')
        on conflict do nothing;
      insert into app.shift_templates (tenant_id, station_id, code, name, created_by)
        values ('${ids.organisation}', '${ids.stationReady}', 'DAY', 'Day', '${ids.membership}')
        on conflict do nothing;
    `);
    await seedClerkIdentity(client, ids.actor);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test.beforeEach(async ({ context, page }) => {
    await authenticateClerk(context, ids.actor);
    await page.goto(
      `/settings?tenantId=${ids.organisation}&legalEntityId=${ids.legalEntity}&stationId=${ids.stationReady}`,
    );
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
  });

  const content = (page: Page) => page.getByRole('main', { name: 'Settings' });
  const tab = (page: Page, name: string) =>
    page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name, exact: true });

  // On a phone the section tabs collapse into a "Settings section" menu.
  async function openSection(page: Page, name: string) {
    const menu = page.locator('summary[aria-label^="Settings section:"]');
    if (await menu.isVisible()) {
      await menu.click();
      await page
        .getByRole('navigation', { name: 'Choose Settings section' })
        .getByRole('button', { name, exact: true })
        .click();
    } else {
      await tab(page, name).click();
    }
  }

  async function expectNoSidewaysScroll(page: Page) {
    const layout = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      view: window.innerWidth,
    }));
    expect(layout.doc).toBeLessThanOrEqual(layout.view);
  }

  test('readiness shows Not entered for unentered setup and never a bare zero', async ({
    page,
  }) => {
    const overviewResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/setup/overview') && response.request().method() === 'GET',
    );
    await tab(page, 'Readiness').click();
    const overviewResponse = await overviewResponsePromise;
    expect(overviewResponse.ok(), `Setup overview returned ${overviewResponse.status()}`).toBe(
      true,
    );
    const bare = page.getByRole('region', { name: /Setup Bare Station/ });
    await expect(bare).toBeVisible();
    await expect(bare.getByText('Not entered').first()).toBeVisible();
    await expect(bare.getByText('Setup incomplete')).toBeVisible();
    await expect(bare.getByText('No tanks have been entered.')).toBeVisible();
    await expect(
      bare.getByText(/transactions|Blocked until setup is complete/).first(),
    ).toBeVisible();
    await expect(content(page).getByText(/\b0\b/)).toHaveCount(0);

    const ready = page.getByRole('region', { name: /Setup Ready Station/ });
    // The ready station has a tank but no opening stock yet, which the Tanks area now says plainly.
    await expect(
      ready.getByText('1 tank entered; opening stock not recorded for 1.'),
    ).toBeVisible();
    await expect(ready.getByText('1 product with an active price.')).toBeVisible();
    await expect(ready.getByText('1 pump and 1 nozzle entered.')).toBeVisible();
    // Payment accounts and staff are genuinely not entered yet.
    await expect(
      ready.getByText('No payment provider accounts or bank accounts have been entered.'),
    ).toBeVisible();
  });

  test('readiness shows a loading state, then recovers from a load error', async ({ page }) => {
    let failing = true;
    await page.route('**/api/setup/overview**', async (route) => {
      if (failing) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.continue();
    });
    await tab(page, 'Readiness').click();
    await expect(page.getByText('Loading station setup')).toBeVisible();
    await expect(page.getByRole('alert').getByText('Setup could not be loaded')).toBeVisible();
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('region', { name: /Setup Bare Station/ })).toBeVisible();
  });

  // Needs a real Clerk second factor (step-up). Skipped, not passed, until the test Clerk instance
  // has one a test can answer repeatedly (after v1: a Clerk test phone number).
  test.fixme('adds a provider and a station account with the existing commands', async ({
    page,
  }) => {
    // The browser step-up UI needs a real password and authenticator code; the
    // session already carries a valid step-up, so the endpoint is stubbed here.
    await page.route('**/api/auth/step-up', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"active"}' }),
    );
    await tab(page, 'Payments').click();
    await expect(page.getByText('No payment providers entered')).toBeVisible();
    await expect(page.getByText('No provider accounts entered')).toBeVisible();

    // Validation first: nothing is sent.
    await page.getByRole('button', { name: 'Add provider', exact: true }).click();
    await expect(page.getByText('Enter the provider name.')).toBeVisible();

    const providerForm = page.getByRole('form', { name: 'Add payment provider' });
    await providerForm.getByLabel('Provider name').fill('Setup E2E POS');
    await providerForm.getByLabel('Provider code').fill('SETUP-E2E-POS');
    await providerForm.getByLabel('Provider type').selectOption('POS');
    await providerForm.getByRole('button', { name: 'Add provider' }).click();

    const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Current password').fill('stubbed-password');
    await dialog.getByLabel('Authenticator code').fill('123456');
    await dialog.getByRole('button', { name: 'Confirm and save' }).click();
    await expect(page.getByText('Setup E2E POS was added.')).toBeVisible();
    await expect(page.getByRole('list').getByText('Setup E2E POS').first()).toBeVisible();

    const accountForm = page.getByRole('form', { name: 'Add provider account' });
    await accountForm
      .getByLabel('Station')
      .selectOption({ label: 'Setup Ready Station (SUP-RDY)' });
    await accountForm.getByLabel('Provider').selectOption({ label: 'Setup E2E POS' });
    await accountForm.getByLabel('Account name').fill('Ready station terminal');
    await accountForm.getByLabel('Merchant or terminal reference').fill('E2E-MERCHANT-1');
    await accountForm.getByLabel('Currency').fill('usd');
    await accountForm.getByRole('button', { name: 'Add provider account' }).click();
    // Step-up is reused for a few minutes, so no second prompt.
    await expect(
      page.getByText('Ready station terminal was added for Setup Ready Station.'),
    ).toBeVisible();

    await tab(page, 'Readiness').click();
    const ready = page.getByRole('region', { name: /Setup Ready Station/ });
    await expect(
      ready.getByText('1 provider account entered; bank account not entered.'),
    ).toBeVisible();
    const bank = page.getByRole('region', { name: /Setup Bare Station/ });
    await expect(
      bank.getByText('No payment provider accounts or bank accounts have been entered.'),
    ).toBeVisible();
  });

  test('owner can open the bank-account setup path without exposing full account numbers', async ({
    page,
  }) => {
    await tab(page, 'Payments').click();
    await expect(page.getByText('No bank accounts entered')).toBeVisible();
    const bankForm = page.getByRole('form', { name: 'Add bank account' });
    await expect(bankForm).toBeVisible();
    await expect(bankForm.getByLabel('Masked account reference')).toBeVisible();
    await expect(bankForm.getByText('Do not enter the full bank account number.')).toBeVisible();
    await expect(bankForm.getByRole('button', { name: 'Add bank account' })).toBeVisible();
  });

  for (const width of WIDTHS) {
    test(`both panels fit ${width}px and have no accessibility violations`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const name of ['Readiness', 'Payments']) {
        await openSection(page, name);
        await expect(content(page).getByRole('heading', { name, level: 2 })).toBeVisible();
        await expect(content(page).getByRole('region').first()).toBeVisible();
        await expectNoSidewaysScroll(page);
        const results = await new AxeBuilder({ page }).analyze();
        expect(results.violations, `axe in ${name} at ${width}px`).toEqual([]);
      }
    });
  }
});
