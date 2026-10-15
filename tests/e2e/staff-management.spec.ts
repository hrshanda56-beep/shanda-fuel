import { createHash } from 'node:crypto';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { makeSignature } from 'better-auth/crypto';
import postgres, { type Sql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;

const ids = {
  tenant: 'b26e0000-0000-4000-8000-000000000001',
  legalEntity: 'b26e0000-0000-4000-8000-000000000011',
  bindura: 'b26e0000-0000-4000-8000-000000000021',
  harare: 'b26e0000-0000-4000-8000-000000000022',
  owner: 'b26e0000-0000-4000-8000-000000000031',
  administrator: 'b26e0000-0000-4000-8000-000000000032',
  finance: 'b26e0000-0000-4000-8000-000000000033',
  supervisor: 'b26e0000-0000-4000-8000-000000000034',
  attendant: 'b26e0000-0000-4000-8000-000000000035',
  existingJoin: 'b26e0000-0000-4000-8000-000000000036',
  ownerMembership: 'b26e0000-0000-4000-8000-000000000041',
  administratorMembership: 'b26e0000-0000-4000-8000-000000000042',
  financeMembership: 'b26e0000-0000-4000-8000-000000000043',
  supervisorMembership: 'b26e0000-0000-4000-8000-000000000044',
  attendantMembership: 'b26e0000-0000-4000-8000-000000000045',
  ownerSession: 'b26e0000-0000-4000-8000-000000000051',
  administratorSession: 'b26e0000-0000-4000-8000-000000000052',
  financeSession: 'b26e0000-0000-4000-8000-000000000053',
  supervisorSession: 'b26e0000-0000-4000-8000-000000000054',
  attendantSession: 'b26e0000-0000-4000-8000-000000000055',
  existingJoinSession: 'b26e0000-0000-4000-8000-000000000056',
};

const sessions = {
  owner: 'b26-owner-session-token',
  administrator: 'b26-administrator-session-token',
  finance: 'b26-finance-session-token',
  supervisor: 'b26-supervisor-session-token',
  attendant: 'b26-attendant-session-token',
  existingJoin: 'b26-existing-join-session-token',
} as const;

const inviteTokens = {
  existing: 'b26-existing-join-token-abcdefghijklmnopqrstuvwxyz',
  newUser: 'b26-new-user-token-abcdefghijklmnopqrstuvwxyz',
  revoked: 'b26-revoked-token-abcdefghijklmnopqrstuvwxyz',
  expired: 'b26-expired-token-abcdefghijklmnopqrstuvwxyz',
  revoke: 'b26-revoke-management-token-abcdefghijklmnopqrstuvwxyz',
} as const;

const invitationIds = {
  existing: 'b26e0000-0000-4000-8000-000000000061',
  newUser: 'b26e0000-0000-4000-8000-000000000062',
  revoked: 'b26e0000-0000-4000-8000-000000000063',
  expired: 'b26e0000-0000-4000-8000-000000000064',
  revoke: 'b26e0000-0000-4000-8000-000000000065',
};

function tokenHash(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function signedCookie(token: string, secret: string) {
  return `${token}.${await makeSignature(token, secret)}`;
}

async function installSessionCookie(context: BrowserContext, token: string) {
  await context.clearCookies();
  await context.addCookies([
    {
      name: 'shanda-fuel.session_token',
      value: await signedCookie(token, authSecret!),
      domain: '127.0.0.1',
      path: '/',
    },
  ]);
}

async function openSettings(page: Page, token: string) {
  await installSessionCookie(page.context(), token);
  const url = `/settings?tenantId=${ids.tenant}&legalEntityId=${ids.legalEntity}&stationId=${ids.bindura}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    if (!String(error).includes('ERR_ABORTED')) throw error;
  }
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  // domcontentloaded returns before React attaches handlers, so an early click on a section
  // tab is a no-op. The shell marks itself once hydration has finished.
  await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
}

async function submitStaffCommandAndWaitForReload(page: Page, action: () => Promise<void>) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/staff/commands') && response.request().method() === 'POST',
  );
  const navigationPromise = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
  });

  await action();

  const response = await responsePromise;
  // Creating an invitation answers 201 Created; resend and revoke answer 200.
  expect([200, 201]).toContain(response.status());
  await navigationPromise;
  await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
}

async function seed(client: Sql) {
  await client.unsafe(`
    delete from app.staff_invitation_stations where tenant_id = '${ids.tenant}';
    delete from app.staff_invitations where tenant_id = '${ids.tenant}';
    delete from platform.security_events where tenant_id = '${ids.tenant}';
    delete from app.membership_role_assignments where tenant_id = '${ids.tenant}';
    delete from app.memberships where tenant_id = '${ids.tenant}';
    delete from auth.session where user_id in ('${ids.owner}', '${ids.administrator}', '${ids.finance}', '${ids.supervisor}', '${ids.attendant}', '${ids.existingJoin}');
    delete from auth.account where user_id in ('${ids.owner}', '${ids.administrator}', '${ids.finance}', '${ids.supervisor}', '${ids.attendant}', '${ids.existingJoin}');
    delete from auth."user" where id in ('${ids.owner}', '${ids.administrator}', '${ids.finance}', '${ids.supervisor}', '${ids.attendant}', '${ids.existingJoin}');
    delete from auth.account where user_id in (
      select id from auth."user" where lower(email) = 'new-user.staff-e2e@example.test'
    );
    delete from auth."user" where lower(email) = 'new-user.staff-e2e@example.test';
    delete from app.stations where tenant_id = '${ids.tenant}';
    delete from app.legal_entities where tenant_id = '${ids.tenant}';
    delete from app.tenants where id = '${ids.tenant}';

    insert into app.tenants (id, name, slug) values ('${ids.tenant}', 'Staff Lifecycle E2E', 'staff-lifecycle-e2e');
    insert into app.legal_entities (id, tenant_id, legal_name, status)
      values ('${ids.legalEntity}', '${ids.tenant}', 'Staff Lifecycle Legal Entity', 'ACTIVE');
    insert into app.stations (id, tenant_id, legal_entity_id, code, name, timezone, status) values
      ('${ids.bindura}', '${ids.tenant}', '${ids.legalEntity}', 'BND-E2E', 'Bindura station', 'Africa/Harare', 'ACTIVE'),
      ('${ids.harare}', '${ids.tenant}', '${ids.legalEntity}', 'HRE-E2E', 'Harare station', 'Africa/Harare', 'ACTIVE');

    insert into auth."user" (id, name, email, email_verified) values
      ('${ids.owner}', 'E2E Owner', 'owner.staff-e2e@example.test', true),
      ('${ids.administrator}', 'E2E Administrator', 'administrator.staff-e2e@example.test', true),
      ('${ids.finance}', 'E2E Finance', 'finance.staff-e2e@example.test', true),
      ('${ids.supervisor}', 'E2E Supervisor', 'supervisor.staff-e2e@example.test', true),
      ('${ids.attendant}', 'E2E Attendant', 'attendant.staff-e2e@example.test', true),
      ('${ids.existingJoin}', 'E2E Existing Join', 'existing-join.staff-e2e@example.test', true);

    insert into app.memberships (id, tenant_id, identity_id, status) values
      ('${ids.ownerMembership}', '${ids.tenant}', '${ids.owner}', 'ACTIVE'),
      ('${ids.administratorMembership}', '${ids.tenant}', '${ids.administrator}', 'ACTIVE'),
      ('${ids.financeMembership}', '${ids.tenant}', '${ids.finance}', 'ACTIVE'),
      ('${ids.supervisorMembership}', '${ids.tenant}', '${ids.supervisor}', 'ACTIVE'),
      ('${ids.attendantMembership}', '${ids.tenant}', '${ids.attendant}', 'ACTIVE');

    insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
      ('${ids.tenant}', '${ids.ownerMembership}', 'OWNER', 'TENANT', null, null),
      ('${ids.tenant}', '${ids.administratorMembership}', 'ADMINISTRATOR', 'TENANT', null, null),
      ('${ids.tenant}', '${ids.financeMembership}', 'FINANCE', 'LEGAL_ENTITY', '${ids.legalEntity}', null),
      ('${ids.tenant}', '${ids.supervisorMembership}', 'SUPERVISOR', 'STATION', '${ids.legalEntity}', '${ids.bindura}'),
      ('${ids.tenant}', '${ids.attendantMembership}', 'ATTENDANT', 'STATION', '${ids.legalEntity}', '${ids.bindura}');

    insert into auth.session
      (id, expires_at, token, user_id, strong_authentication_verified, strong_authenticated_at, strong_authentication_expires_at, step_up_level, step_up_expires_at, step_up_tenant_id)
    values
      ('${ids.ownerSession}', '2030-01-01T00:00:00Z', '${sessions.owner}', '${ids.owner}', true, now(), '2030-01-01T00:00:00Z', 2, '2030-01-01T00:00:00Z', '${ids.tenant}'),
      ('${ids.administratorSession}', '2030-01-01T00:00:00Z', '${sessions.administrator}', '${ids.administrator}', true, now(), '2030-01-01T00:00:00Z', 2, '2030-01-01T00:00:00Z', '${ids.tenant}'),
      ('${ids.financeSession}', '2030-01-01T00:00:00Z', '${sessions.finance}', '${ids.finance}', true, now(), '2030-01-01T00:00:00Z', 2, '2030-01-01T00:00:00Z', '${ids.tenant}'),
      ('${ids.supervisorSession}', '2030-01-01T00:00:00Z', '${sessions.supervisor}', '${ids.supervisor}', true, now(), '2030-01-01T00:00:00Z', 2, '2030-01-01T00:00:00Z', '${ids.tenant}'),
      ('${ids.attendantSession}', '2030-01-01T00:00:00Z', '${sessions.attendant}', '${ids.attendant}', true, now(), '2030-01-01T00:00:00Z', 2, '2030-01-01T00:00:00Z', '${ids.tenant}'),
      ('${ids.existingJoinSession}', '2030-01-01T00:00:00Z', '${sessions.existingJoin}', '${ids.existingJoin}', true, now(), '2030-01-01T00:00:00Z', 2, '2030-01-01T00:00:00Z', '${ids.tenant}');

    insert into app.staff_invitations
      (id, tenant_id, invited_email, invited_name, assigned_role, scope_type, legal_entity_id, token_hash, status, expires_at, revoked_at, created_at, created_by_user_id, created_by_membership_id)
    values
      ('${invitationIds.existing}', '${ids.tenant}', 'existing-join.staff-e2e@example.test', 'Existing Join', 'SUPERVISOR', 'STATION', '${ids.legalEntity}', '${tokenHash(inviteTokens.existing)}', 'PENDING', now() + interval '72 hours', null, now(), '${ids.owner}', '${ids.ownerMembership}'),
      ('${invitationIds.newUser}', '${ids.tenant}', 'new-user.staff-e2e@example.test', 'New User', 'FINANCE', 'LEGAL_ENTITY', '${ids.legalEntity}', '${tokenHash(inviteTokens.newUser)}', 'PENDING', now() + interval '72 hours', null, now(), '${ids.owner}', '${ids.ownerMembership}'),
      ('${invitationIds.revoked}', '${ids.tenant}', 'revoked.staff-e2e@example.test', 'Revoked Invite', 'ATTENDANT', 'STATION', '${ids.legalEntity}', '${tokenHash(inviteTokens.revoked)}', 'REVOKED', now() + interval '72 hours', now(), now(), '${ids.owner}', '${ids.ownerMembership}'),
      ('${invitationIds.expired}', '${ids.tenant}', 'expired.staff-e2e@example.test', 'Expired Invite', 'ATTENDANT', 'STATION', '${ids.legalEntity}', '${tokenHash(inviteTokens.expired)}', 'EXPIRED', now() - interval '1 day', null, now() - interval '3 days', '${ids.owner}', '${ids.ownerMembership}'),
      ('${invitationIds.revoke}', '${ids.tenant}', 'revoke-management.staff-e2e@example.test', 'Revoke Management', 'SUPERVISOR', 'STATION', '${ids.legalEntity}', '${tokenHash(inviteTokens.revoke)}', 'PENDING', now() + interval '72 hours', null, now(), '${ids.owner}', '${ids.ownerMembership}');

    insert into app.staff_invitation_stations (tenant_id, invitation_id, legal_entity_id, station_id) values
      ('${ids.tenant}', '${invitationIds.existing}', '${ids.legalEntity}', '${ids.bindura}'),
      ('${ids.tenant}', '${invitationIds.revoked}', '${ids.legalEntity}', '${ids.bindura}'),
      ('${ids.tenant}', '${invitationIds.expired}', '${ids.legalEntity}', '${ids.bindura}'),
      ('${ids.tenant}', '${invitationIds.revoke}', '${ids.legalEntity}', '${ids.bindura}');
  `);
}

test.describe('authenticated Staff lifecycle', () => {
  test.skip(
    !databaseUrl || !authSecret,
    'Staff lifecycle E2E requires the disposable PostgreSQL database and Better Auth secret',
  );
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  let client: Sql;

  test.beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await seed(client);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  test('Owner can manage invitations and Staff remains accessible', async ({ page }) => {
    await openSettings(page, sessions.owner);
    await page.getByRole('button', { name: 'Staff', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Invite staff', level: 3 })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth),
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.emulateMedia({ colorScheme: 'dark' });

    const form = page.locator('form').filter({ has: page.locator('input[name="name"]') });
    async function setSelect(label: string, value: string) {
      const select =
        label === 'Legal entity' ? form.locator('select[required]') : form.getByLabel(label);
      await select.selectOption(value);
    }
    async function invite(name: string, email: string, role: string) {
      await form.locator('input[name="name"]').fill(name);
      await form.locator('input[name="email"]').fill(email);
      await setSelect('Role', role);
      if (role === 'FINANCE') {
        await setSelect('Scope', 'LEGAL_ENTITY');
        await setSelect('Legal entity', ids.legalEntity);
      }
      if (role === 'ATTENDANT' || role === 'SUPERVISOR') {
        await setSelect('Scope', 'STATION');
        await setSelect('Legal entity', ids.legalEntity);
        await form
          .locator('input[type="checkbox"]')
          .first()
          .evaluate((input) => {
            (input as HTMLInputElement).click();
          });
      }
      await submitStaffCommandAndWaitForReload(page, () =>
        form.getByRole('button', { name: 'Send invitation' }).click(),
      );
      await openSettings(page, sessions.owner);
      await page.getByRole('button', { name: 'Staff', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Invite staff', level: 3 })).toBeVisible();
    }

    await invite('Owner invited attendant', 'owner-attendant.staff-e2e@example.test', 'ATTENDANT');
    await invite(
      'Owner invited supervisor',
      'owner-supervisor.staff-e2e@example.test',
      'SUPERVISOR',
    );
    await invite('Owner invited finance', 'owner-finance.staff-e2e@example.test', 'FINANCE');
    await invite(
      'Owner invited administrator',
      'owner-admin.staff-e2e@example.test',
      'ADMINISTRATOR',
    );

    const created = await client.unsafe<
      { id: string; invited_email: string; status: string; token_hash: string }[]
    >(
      `select id, invited_email, status, token_hash from app.staff_invitations where tenant_id = '${ids.tenant}' and invited_email like 'owner-%staff-e2e@example.test' order by invited_email`,
    );
    expect(created).toHaveLength(4);
    expect(created.every((row) => row.status === 'PENDING')).toBe(true);
    expect(created.every((row) => /^[0-9a-f]{64}$/.test(row.token_hash))).toBe(true);

    const existingRow = page
      .getByText('revoke-management.staff-e2e@example.test', { exact: false })
      .locator('xpath=../..');
    await submitStaffCommandAndWaitForReload(page, () =>
      existingRow.getByRole('button', { name: 'Resend' }).click(),
    );
    await page.getByRole('button', { name: 'Staff', exact: true }).click();
    await expect(
      page.getByText('revoke-management.staff-e2e@example.test', { exact: false }),
    ).toBeVisible();
    await submitStaffCommandAndWaitForReload(page, () =>
      existingRow.getByRole('button', { name: 'Revoke' }).click(),
    );
    await openSettings(page, sessions.owner);
    await page.getByRole('button', { name: 'Staff', exact: true }).click();
    await expect(
      page.getByText('revoke-management.staff-e2e@example.test', { exact: false }),
    ).toHaveCount(0);

    const first = await client.unsafe<{ id: string; status: string; expires_at: Date }[]>(
      `select id, status, expires_at from app.staff_invitations where invited_email = 'revoke-management.staff-e2e@example.test'`,
    );
    expect(first[0]?.status).toBe('REVOKED');
    expect(first[0]?.expires_at).toBeTruthy();
  });

  test('Administrator is scoped to non-privileged invites and restricted roles are denied', async ({
    page,
  }) => {
    await openSettings(page, sessions.administrator);
    const staffButton = page.getByRole('button', { name: 'Staff', exact: true });
    await expect(staffButton).toBeVisible();
    await staffButton.click();
    await expect(page.getByLabel('Role').locator('option', { hasText: 'Owner' })).toHaveCount(0);

    const adminCookie = await signedCookie(sessions.administrator, authSecret!);
    const canInvite = await page.request.post('/api/staff/commands', {
      headers: { cookie: `shanda-fuel.session_token=${adminCookie}` },
      data: {
        tenantId: ids.tenant,
        commandType: 'CreateStaffInvitation',
        invitedName: 'Administrator finance invite',
        invitedEmail: 'administrator-finance.staff-e2e@example.test',
        assignedRole: 'FINANCE',
        scopeType: 'LEGAL_ENTITY',
        legalEntityId: ids.legalEntity,
        stationIds: [],
      },
    });
    expect(canInvite.status()).toBe(201);

    for (const role of ['OWNER', 'ADMINISTRATOR']) {
      const response = await page.request.post('/api/staff/commands', {
        headers: { cookie: `shanda-fuel.session_token=${adminCookie}` },
        data: {
          tenantId: ids.tenant,
          commandType: 'CreateStaffInvitation',
          invitedName: `Administrator denied ${role}`,
          invitedEmail: `administrator-denied-${role.toLowerCase()}.staff-e2e@example.test`,
          assignedRole: role,
          scopeType: 'TENANT',
          stationIds: [],
        },
      });
      expect(response.status(), `administrator must not invite ${role}`).toBe(403);
    }

    for (const token of [sessions.finance, sessions.supervisor, sessions.attendant]) {
      await openSettings(page, token);
      await expect(page.getByRole('button', { name: 'Staff', exact: true })).toHaveCount(0);
      const denied = await page.request.post('/api/staff/commands', {
        data: {
          tenantId: ids.tenant,
          commandType: 'CreateStaffInvitation',
          invitedName: 'Denied restricted invite',
          invitedEmail: `denied-${token}@staff-e2e.example.test`,
          assignedRole: 'ATTENDANT',
          scopeType: 'STATION',
          legalEntityId: ids.legalEntity,
          stationIds: [ids.bindura],
        },
      });
      expect(denied.status()).toBe(403);
    }
  });

  test('invalid, revoked and expired links fail closed; existing and new users accept once', async ({
    page,
    browser,
  }) => {
    for (const token of ['not-a-valid-token', inviteTokens.revoked, inviteTokens.expired]) {
      await page.goto(`/invite/${token}`);
      await expect(
        page.getByRole('heading', { name: 'This invitation is no longer available', level: 1 }),
      ).toBeVisible();
    }

    await installSessionCookie(page.context(), sessions.existingJoin);
    await page.goto(`/invite/${inviteTokens.existing}`);
    await expect(
      page.getByRole('heading', { name: 'Join your new workspace', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept invitation' })).toBeVisible();
    const acceptResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/invite/${inviteTokens.existing}/accept`) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    const acceptResponse = await acceptResponsePromise;
    expect(acceptResponse.ok(), `Invitation acceptance returned ${acceptResponse.status()}`).toBe(
      true,
    );
    await expect(page).not.toHaveURL(new RegExp(`/invite/${inviteTokens.existing}$`));
    await expect(
      page.getByRole('heading', { name: 'This invitation is no longer available', level: 1 }),
    ).toHaveCount(0);

    const existingAccepted = await client.unsafe<
      { status: string; role_code: string; station_id: string }[]
    >(
      `select invitation.status, assignment.role_code, assignment.station_id from app.staff_invitations invitation join app.membership_role_assignments assignment on assignment.membership_id = invitation.accepted_membership_id where invitation.id = '${invitationIds.existing}'`,
    );
    expect(existingAccepted[0]).toMatchObject({
      status: 'ACCEPTED',
      role_code: 'SUPERVISOR',
      station_id: ids.bindura,
    });

    const newContext = await browser.newContext();
    const newPage = await newContext.newPage();
    try {
      await newPage.goto(`/invite/${inviteTokens.newUser}`);
      await expect(
        newPage.getByRole('heading', { name: "You're joining Shanda Fuel", level: 1 }),
      ).toBeVisible();
      await expect(newPage.getByLabel('Invited email')).toHaveValue(
        'new-user.staff-e2e@example.test',
      );
      await newPage.setViewportSize({ width: 390, height: 844 });
      await newPage.emulateMedia({ colorScheme: 'light' });
      expect((await new AxeBuilder({ page: newPage }).analyze()).violations).toEqual([]);
      await newPage.getByLabel('Create password').fill('synthetic-password');
      await newPage.getByLabel('Confirm password').fill('synthetic-password');
      await newPage.getByRole('button', { name: 'Join workspace' }).click();
      // Signup, Better Auth session establishment and the first acceptance
      // request can each cold-compile under the serial browser suite.
      await expect(newPage).not.toHaveURL(new RegExp(`/invite/${inviteTokens.newUser}$`), {
        timeout: 30_000,
      });
    } finally {
      await newContext.close();
    }

    const newAccepted = await client.unsafe<
      { status: string; email: string; role_code: string; scope_type: string }[]
    >(
      `select invitation.status, identity.email, assignment.role_code, assignment.scope_type from app.staff_invitations invitation join auth."user" identity on identity.email = invitation.invited_email join app.membership_role_assignments assignment on assignment.membership_id = invitation.accepted_membership_id where invitation.id = '${invitationIds.newUser}'`,
    );
    expect(newAccepted[0]).toMatchObject({
      status: 'ACCEPTED',
      email: 'new-user.staff-e2e@example.test',
      role_code: 'FINANCE',
      scope_type: 'LEGAL_ENTITY',
    });

    await openSettings(page, sessions.owner);
    await page.getByRole('button', { name: 'Staff', exact: true }).click();
    const attendantRow = page
      .getByText('E2E Attendant · attendant.staff-e2e@example.test', { exact: true })
      .locator('xpath=../..');
    await attendantRow.getByRole('button', { name: 'Deactivate' }).click();
    const deactivationDialog = page.getByRole('alertdialog', {
      name: 'Deactivate staff member?',
    });
    await expect(deactivationDialog).toBeVisible();
    await deactivationDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(deactivationDialog).toHaveCount(0);

    const deactivation = await page.request.post('/api/staff/commands', {
      headers: {
        cookie: `shanda-fuel.session_token=${await signedCookie(sessions.owner, authSecret!)}`,
      },
      data: {
        tenantId: ids.tenant,
        commandType: 'DeactivateStaffMember',
        membershipId: ids.attendantMembership,
      },
    });
    expect(deactivation.status()).toBe(200);
    await expect(deactivation.json()).resolves.toMatchObject({
      sessionsRevoked: true,
    });

    await openSettings(page, sessions.owner);
    await page.getByRole('button', { name: 'Staff', exact: true }).click();
    await expect(page.getByText('Deactivated; history retained', { exact: true })).toBeVisible();

    const deactivated = await client.unsafe<
      { status: string; revoked_at: Date | null; audit_count: string }[]
    >(
      `select membership.status, session.revoked_at, (select count(*) from platform.security_events where tenant_id = '${ids.tenant}' and event_code = 'STAFF.MEMBERSHIP_DEACTIVATED')::text as audit_count from app.memberships membership left join auth.session session on session.user_id = membership.identity_id where membership.id = '${ids.attendantMembership}'`,
    );
    expect(deactivated[0]).toMatchObject({ status: 'DISABLED' });
    expect(deactivated[0]?.revoked_at).toBeTruthy();
    expect(Number(deactivated[0]?.audit_count)).toBeGreaterThan(0);

    const lastOwner = await page.request.post('/api/staff/commands', {
      data: {
        tenantId: ids.tenant,
        commandType: 'DeactivateStaffMember',
        membershipId: ids.ownerMembership,
      },
    });
    expect(lastOwner.status()).toBe(403);

    await installSessionCookie(page.context(), sessions.attendant);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login$/);
  });
});
