import { expect, test, type Page } from '@playwright/test';

/*
 * Business-day lock in the approved control-room layout, with PR #120's step-up
 * behaviour preserved. Database-free: the overview API is answered by the test and
 * the server's own gating is represented by the `actions.LockBusinessDay` flags the
 * real server derives (canExecute is false whenever step-up is still required).
 * Better Auth is selected (AUTH_PROVIDER=BETTER_AUTH). Clerk mode renders
 * ClerkStepUpForm instead, which needs a ClerkProvider and live keys; it is covered by
 * the verify-clerk-stepup.sh source check and a manual Clerk-instance check, not here.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const STATION = '22222222-2222-4222-8222-222222222222';
const DAY = '33333333-3333-4333-8333-333333333333';
const URL = `/operations/daily?tenantId=${TENANT}&stationId=${STATION}`;

type LockFlags = { canExecute: boolean; permissionGranted: boolean; requiresStepUp: boolean };

const NONE = { canExecute: false, permissionGranted: false, requiresStepUp: false };

function overview(lock: LockFlags) {
  const day = {
    id: DAY,
    date: '2026-10-12',
    state: 'CLOSED',
    version: 7,
    openedAt: '2026-10-12T04:00:00Z',
    closedAt: '2026-10-12T18:00:00Z',
    updatedAt: '2026-10-12T18:00:00Z',
  };
  return {
    station: { id: STATION, code: 'BIN', name: 'Bindura', timezone: 'Africa/Harare' },
    organisation: { id: TENANT, name: 'Sample organisation' },
    currentBusinessDate: '2026-10-12',
    currentBusinessDayId: DAY,
    visibility: { reconciliations: false, auditTimeline: false },
    actions: {
      OpenBusinessDay: NONE,
      CloseBusinessDay: NONE,
      LockBusinessDay: lock,
      StartShift: NONE,
      CloseMeters: NONE,
      CompleteShift: NONE,
    },
    businessDays: [day],
    selectedBusinessDay: day,
    shifts: [],
    reconciliations: [],
    timeline: [],
  };
}

async function arrange(page: Page, lock: LockFlags) {
  await page.route('**/api/context**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          available: { organisations: [] },
          current: null,
          route: {
            pathname: '/operations/daily',
            policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: true },
          },
          persistedContextInvalid: false,
        },
      }),
    }),
  );
  await page.route('**/api/forecourt/operations/overview**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(overview(lock)) }),
  );
  // Better Auth, TOTP already enrolled: the step-up form shows password + code.
  await page.route('**/api/auth/mfa/setup', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true }) }),
  );
  await page.goto(URL);
  await expect(
    page
      .getByRole('region', { name: 'Operations control room' })
      .or(page.locator('[aria-label="Operations control room"]')),
  ).toBeVisible();
}

const lockButtons = (page: Page) => page.getByRole('button', { name: 'Lock business day' });

test.describe('lock business day', () => {
  test('step-up still required: one visible, disabled lock action and the step-up form', async ({
    page,
  }) => {
    await arrange(page, { canExecute: false, permissionGranted: true, requiresStepUp: true });
    await expect(lockButtons(page)).toHaveCount(1);
    await expect(lockButtons(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Verify step-up' })).toBeVisible();
    await expect(page.getByText(/requires current privileged reverification/)).toBeVisible();
  });

  test('step-up satisfied by the server: one enabled lock action, no step-up form', async ({
    page,
  }) => {
    await arrange(page, { canExecute: true, permissionGranted: true, requiresStepUp: false });
    await expect(lockButtons(page)).toHaveCount(1);
    await expect(lockButtons(page)).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Verify step-up' })).toHaveCount(0);
  });

  test('without permission there is no lock action and no step-up form', async ({ page }) => {
    await arrange(page, NONE);
    await expect(lockButtons(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Verify step-up' })).toHaveCount(0);
  });

  test('the UI never locks on its own: the server decides, and a refusal changes nothing', async ({
    page,
  }) => {
    await arrange(page, { canExecute: true, permissionGranted: true, requiresStepUp: false });
    const posted: Array<Record<string, unknown>> = [];
    await page.route('**/api/forecourt/commands', async (route) => {
      posted.push(JSON.parse(route.request().postData() ?? '{}'));
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'FORBIDDEN', message: 'step-up expired' }),
      });
    });
    page.once('dialog', (dialog) => void dialog.accept());
    await lockButtons(page).click();
    await expect(
      page.getByText(/requires the existing step-up authentication flow. No change was posted./),
    ).toBeVisible();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      commandType: 'LockBusinessDay',
      tenantId: TENANT,
      stationId: STATION,
      businessDayId: DAY,
      expectedVersion: 7,
    });
    // Still exactly one lock action, not reported as locked.
    await expect(lockButtons(page)).toHaveCount(1);
    await expect(page.getByText('Business day locked.')).toHaveCount(0);
  });
});
