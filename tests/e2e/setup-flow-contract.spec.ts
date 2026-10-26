import { clerkFixturesAvailable, authenticateClerk, seedClerkIdentity } from './clerk-fixtures';
import { expect, test } from '@playwright/test';
import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

const ids = {
  tenant: 'e2e90000-0000-4000-8000-000000000001',
  legalEntity: 'e2e90000-0000-4000-8000-000000000011',
  station: 'e2e90000-0000-4000-8000-000000000021',
  owner: 'e2e90000-0000-4000-8000-000000000031',
  membership: 'e2e90000-0000-4000-8000-000000000041',
};

const runnable = Boolean(databaseUrl) && clerkFixturesAvailable([ids.owner]);

test.describe('zero-to-setup browser contract', () => {
  test.skip(
    !runnable,
    'Zero-to-setup E2E requires disposable PostgreSQL and a Clerk development fixture for the owner',
  );
  test.describe.configure({ mode: 'serial' });

  let client: Sql;

  test.beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await client.unsafe(`
      delete from app.membership_role_assignments where tenant_id = '${ids.tenant}';
      delete from app.memberships where tenant_id = '${ids.tenant}';
      delete from app.auth_identities where internal_user_id = '${ids.owner}';
      delete from app.users where id = '${ids.owner}';
      delete from app.stations where tenant_id = '${ids.tenant}';
      delete from app.legal_entities where tenant_id = '${ids.tenant}';
      delete from app.tenants where id = '${ids.tenant}';

      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Setup Contract Company', 'setup-contract-company');
      insert into app.legal_entities (id, tenant_id, legal_name, status) values
        ('${ids.legalEntity}', '${ids.tenant}', 'Setup Contract Company Ltd', 'ACTIVE');
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, timezone, status) values
        ('${ids.station}', '${ids.tenant}', '${ids.legalEntity}', 'CONTRACT-1', 'Contract Station', 'Africa/Harare', 'ONBOARDING');
      insert into app.users (id, name, email, email_verified) values
        ('${ids.owner}', 'Setup Contract Owner', 'setup-contract-owner@example.test', true);
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.membership}', '${ids.tenant}', '${ids.owner}', 'ACTIVE');
      insert into app.membership_role_assignments
        (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id)
      values ('${ids.tenant}', '${ids.membership}', 'OWNER', 'TENANT', null, null);
    `);
    await seedClerkIdentity(client, ids.owner);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test('company, station and owner user reach and use the real guided setup flow', async ({
    context,
    page,
  }) => {
    await authenticateClerk(context, ids.owner);
    await page.goto(
      `/settings?tenantId=${ids.tenant}&legalEntityId=${ids.legalEntity}&stationId=${ids.station}`,
    );

    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Companies', exact: true }).click();
    await expect(page.getByText('Setup Contract Company Ltd', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Stations', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Contract Station', level: 3 })).toBeVisible();

    await page.getByRole('button', { name: 'Station setup', exact: true }).click();
    const form = page.getByRole('form', { name: 'Add a fuel type' });
    await expect(form).toBeVisible();
    await form.getByLabel('Fuel name').fill('Contract Diesel');
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/setup/commands') && response.request().method() === 'POST',
    );
    await form.getByRole('button', { name: 'Add fuel type' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await expect(page.getByRole('status')).toContainText('Contract Diesel was added.');

    await page.getByRole('button', { name: 'Readiness', exact: true }).click();
    const station = page.getByRole('region', { name: /Contract Station/ });
    await expect(station).toBeVisible();
    await expect(station.getByText('Prices not entered for this station.')).toBeVisible();
  });
});
