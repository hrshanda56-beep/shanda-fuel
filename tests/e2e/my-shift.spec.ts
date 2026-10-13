import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The attendant workspace, against mocked data routes. Authorization, tenant and
 * station isolation are proven against the real database in the integration
 * evidence; this spec covers what the person sees and does.
 */

const WIDTHS = [320, 390, 430, 768, 1440];

type Boundary = { status: 'RECORDED'; value: string; recordedAt: string } | null;

function shiftData(
  overrides: {
    state?: string;
    now?: string;
    opening?: Boundary;
    closing?: Boundary;
    previousReading?: string | null;
    noShift?: boolean;
  } = {},
) {
  const base = {
    station: { id: 'e2e-station', name: 'Bindura', timezone: 'Africa/Harare' },
    tenantId: 'e2e-tenant',
    legalEntityId: 'e2e-le',
    now: overrides.now ?? '2026-10-09T09:00:00.000Z',
    responsibleAttendantId: '256129bb-ea7c-467d-adad-7dce26b64e09',
    canCapture: true,
  };
  if (overrides.noShift) return { ...base, shift: null, meters: [] };
  return {
    ...base,
    shift: {
      id: 'shift-1',
      businessDayId: 'day-1',
      label: 'Day shift',
      state: overrides.state ?? 'OPEN',
      businessDayState: 'OPEN',
      plannedStartAt: '2026-10-09T04:00:00.000Z',
      plannedEndAt: '2026-10-09T16:00:00.000Z',
      version: 2,
    },
    meters: [
      {
        nozzleId: 'nozzle-1',
        meterInstallationId: 'install-1',
        pumpNumber: '1',
        nozzleNumber: '1',
        productName: 'Diesel',
        previousReading:
          overrides.previousReading === undefined ? '1000.000' : overrides.previousReading,
        opening: overrides.opening ?? null,
        closing: overrides.closing ?? null,
      },
    ],
  };
}

async function mockShift(page: Page, data: unknown, status = 200) {
  await page.route('**/api/forecourt/my-shift**', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) }),
  );
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('My Shift layout', () => {
  for (const width of WIDTHS) {
    test(`is simple, readable and accessible at ${width}px`, async ({ page }) => {
      await mockShift(page, shiftData());
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/my-shift');

      await expect(page.getByRole('heading', { level: 1, name: 'Bindura' })).toBeVisible();
      await expect(page.getByText('06:00–18:00')).toBeVisible();
      await expect(page.getByText('Day shift', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'What to do next' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Pump 1 · Nozzle 1' })).toBeVisible();
      await expect(page.getByText('Opening reading', { exact: true })).toBeVisible();
      await expect(page.getByText('Closing reading', { exact: true })).toBeVisible();
      await noSidewaysScroll(page);

      // Big tap targets for the primary action.
      const record = page.getByRole('button', { name: 'Record reading' });
      await expect(record).toBeVisible();
      expect((await record.boundingBox())!.height).toBeGreaterThanOrEqual(44);

      // No management vocabulary in the attendant's content.
      const main = (await page.locator('.my-shift').innerText()).toLowerCase();
      for (const word of [
        'reports',
        'reconciliation',
        'inventory',
        'permission',
        'administrator',
      ]) {
        expect(main).not.toContain(word);
      }

      const results = await new AxeBuilder({ page }).include('.my-shift').analyze();
      expect(results.violations).toEqual([]);
    });
  }
});

test.describe('My Shift states', () => {
  test('shows a calm message when there is no shift', async ({ page }) => {
    await mockShift(page, shiftData({ noShift: true }));
    await page.goto('/my-shift');
    await expect(page.getByText('There is no shift to work on right now.')).toBeVisible();
    await expect(page.getByRole('button', { name: /record/i })).toHaveCount(0);
  });

  test('shows a completed opening and closing as not yet due', async ({ page }) => {
    await mockShift(
      page,
      shiftData({
        opening: { status: 'RECORDED', value: '1000.000', recordedAt: '2026-10-09T05:00:00Z' },
      }),
    );
    await page.goto('/my-shift');
    await expect(page.getByText('✓ Completed')).toBeVisible();
    await expect(page.getByText('Not yet due')).toBeVisible();
    await expect(page.getByRole('button', { name: /record/i })).toHaveCount(0);
  });

  test('offers the closing reading once it is due', async ({ page }) => {
    await mockShift(
      page,
      shiftData({
        now: '2026-10-09T16:10:00.000Z',
        opening: { status: 'RECORDED', value: '1000.000', recordedAt: '2026-10-09T05:00:00Z' },
      }),
    );
    await page.goto('/my-shift');
    // The next-action card names the nozzle and the reading instead of a sentence.
    const next = page.locator('.my-shift-next');
    await expect(next).toContainText('Pump 1 · Nozzle 1');
    await expect(next).toContainText('Closing reading');
    await expect(page.getByRole('button', { name: 'Record reading' })).toBeVisible();
  });

  test('waits for the supervisor when the shift has not started', async ({ page }) => {
    await mockShift(page, shiftData({ state: 'PLANNED' }));
    await page.goto('/my-shift');
    await expect(page.getByText('Your shift has not started yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: /record/i })).toHaveCount(0);
  });

  test('explains a load failure and retries', async ({ page }) => {
    let failing = true;
    await page.route('**/api/forecourt/my-shift**', (route) =>
      failing
        ? route.fulfill({ status: 500, body: '{}', contentType: 'application/json' })
        : route.fulfill({ contentType: 'application/json', body: JSON.stringify(shiftData()) }),
    );
    await page.goto('/my-shift');
    await expect(page.locator('.state-error')).toContainText('could not be loaded');
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Bindura' })).toBeVisible();
  });
});

test.describe('My Shift capture', () => {
  test('validates in plain language, then records once even on a double tap', async ({ page }) => {
    let data = shiftData();
    await page.route('**/api/forecourt/my-shift**', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }),
    );
    const posts: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    await page.route('**/api/forecourt/commands', async (route) => {
      posts.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
      await new Promise((resolve) => setTimeout(resolve, 300));
      data = shiftData({
        opening: { status: 'RECORDED', value: '1000', recordedAt: '2026-10-09T09:00:00Z' },
      });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ result: { boundaryId: 'x' } }),
      });
    });

    await page.goto('/my-shift');
    await page.getByRole('button', { name: 'Record reading' }).click();
    const input = page.getByRole('textbox', { name: /Opening reading/ });
    await expect(input).toBeFocused();

    await page.getByRole('button', { name: 'Save opening reading' }).click();
    await expect(page.getByText('Enter the number shown on the meter.')).toBeVisible();

    await input.fill('abc');
    await page.getByRole('button', { name: 'Save opening reading' }).click();
    await expect(page.getByText(/Use numbers only/)).toBeVisible();

    await input.fill('1001');
    await page.getByRole('button', { name: 'Save opening reading' }).click();
    await expect(page.getByText(/must match the last closing reading \(1000.000\)/)).toBeVisible();
    expect(posts).toHaveLength(0);

    await input.fill('1000');
    const save = page.getByRole('button', { name: /Save opening reading|Saving/ });
    await save.dblclick();
    await expect(
      page.getByRole('status').filter({ hasText: 'Opening reading saved' }),
    ).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers['idempotency-key']).toBeTruthy();
    expect(posts[0]!.body).toMatchObject({
      commandType: 'ConfirmBoundary',
      reason: 'SHIFT_OPEN',
      readingStatus: 'AVAILABLE',
      readingValue: '1000',
      shiftId: 'shift-1',
      nozzleId: 'nozzle-1',
      expectedVersion: 2,
      responsibleAttendantId: '256129bb-ea7c-467d-adad-7dce26b64e09',
    });
  });

  test('asks why there is no earlier reading for a brand-new meter', async ({ page }) => {
    await mockShift(page, shiftData({ previousReading: null }));
    await page.goto('/my-shift');
    await page.getByRole('button', { name: 'Record reading' }).click();
    await page.getByRole('textbox', { name: /Opening reading/ }).fill('250');
    await page.getByRole('button', { name: 'Save opening reading' }).click();
    await expect(page.getByText('Say why there is no earlier reading.')).toBeVisible();
  });

  test('shows a plain message when the server refuses and keeps nothing recorded', async ({
    page,
  }) => {
    await mockShift(page, shiftData());
    await page.route('**/api/forecourt/commands', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'FORBIDDEN', message: 'internal detail' }),
      }),
    );
    await page.goto('/my-shift');
    await page.getByRole('button', { name: 'Record reading' }).click();
    await page.getByRole('textbox', { name: /Opening reading/ }).fill('1000');
    await page.getByRole('button', { name: 'Save opening reading' }).click();
    await expect(
      page.getByText('You are not allowed to record this reading. Tell your supervisor.'),
    ).toBeVisible();
    await expect(page.getByText('internal detail')).toHaveCount(0);
  });
});
