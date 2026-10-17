import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import { totpCode } from '../integration/synthetic-totp';
import postgres, { type Sql } from 'postgres';
import { ExactDecimal } from '../../src/platform/domain/primitives';
import {
  ids,
  supervisorToken,
  managerToken,
  seedOwnerWorkflow,
  seedSecondNozzle,
} from '../fixtures/owner-workflow';

const databaseUrl = process.env.DATABASE_FIXTURE_URL ?? process.env.DATABASE_URL;

let managerMfaSecret: string | undefined;
let managerCookieValue: string | undefined;

test.describe('production reconciliation persistence', () => {
  test.skip(!databaseUrl, 'production persistence E2E requires CI PostgreSQL');
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  let client: Sql;

  test.beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    await seedOwnerWorkflow(client);
  });

  test.afterAll(async () => {
    await client?.end();
  });

  async function signedCookie(token: string) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error('BETTER_AUTH_SECRET is required for production E2E');
    return `${token}.${await makeSignature(token, secret)}`;
  }

  async function authenticate(context: BrowserContext, token: string) {
    await context.clearCookies();
    await context.addCookies([
      {
        name: 'shanda-fuel.session_token',
        value:
          token === managerToken && managerCookieValue
            ? managerCookieValue
            : await signedCookie(token),
        domain: '127.0.0.1',
        path: '/',
      },
    ]);
    if (token === managerToken && !managerMfaSecret) {
      const setup = await context.request.post('/api/auth/mfa/setup', {
        data: { password: 'synthetic-e2e-owner-password' },
      });
      expect(setup.ok(), await setup.text()).toBe(true);
      const enrollment = (await setup.json()) as { totpURI: string };
      managerMfaSecret = new URL(enrollment.totpURI).searchParams.get('secret')!;
      const verified = await context.request.post('/api/auth/mfa/setup/verify', {
        data: { code: totpCode(managerMfaSecret) },
      });
      expect(verified.ok(), await verified.text()).toBe(true);
      managerCookieValue = (await context.cookies()).find(
        (cookie) => cookie.name === 'shanda-fuel.session_token',
      )?.value;
    }
  }

  async function verifyApproval(page: import('@playwright/test').Page) {
    const dialog = page.getByRole('dialog', { name: 'Verify identity for approval' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Approve production reconciliation' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Current password').fill('incorrect-password');
    await dialog.getByLabel('Authenticator code').fill(totpCode(managerMfaSecret!));
    const failed = page.waitForResponse((response) => response.url().includes('/api/auth/step-up'));
    await dialog.getByRole('button', { name: 'Verify identity', exact: true }).click();
    expect((await failed).status()).toBe(403);
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByLabel('Current password').fill('synthetic-e2e-owner-password');
    await dialog.getByLabel('Authenticator code').fill(totpCode(managerMfaSecret!));
    await dialog.getByRole('button', { name: 'Verify identity', exact: true }).click();
  }

  async function gotoAndWaitForHydration(page: import('@playwright/test').Page, url: string) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // Hydration is a navigation readiness phase, bounded by the existing test
    // deadline; cold development chunks can arrive after DOMContentLoaded.
    await page.locator('.app-shell[data-hydrated="true"]').waitFor({ state: 'attached' });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-hydrated', 'true');
  }

  async function command(request: APIRequestContext, input: Record<string, unknown>, key: string) {
    const response = await request.post('/api/forecourt/commands', {
      data: input,
      headers: { 'idempotency-key': key },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json() as Promise<{ version?: number; state?: string }>;
  }

  async function prepareFixtureShift(shiftId: string) {
    const rows = await client.unsafe<{ planned_start_at: Date; planned_end_at: Date }[]>(`
      update app.shifts as fixture_shift
      set planned_start_at = database_clock.current_time - interval '5 minutes',
          planned_end_at = database_clock.current_time + interval '15 minutes'
      from (select clock_timestamp() as current_time) as database_clock
      where fixture_shift.tenant_id='${ids.tenant}'
        and fixture_shift.station_id='${ids.station}'
        and fixture_shift.id='${shiftId}'
        and fixture_shift.state='OPEN'
      returning fixture_shift.planned_start_at, fixture_shift.planned_end_at
    `);
    expect(rows).toHaveLength(1);
    const shift = rows[0];
    if (!shift) throw new Error(`Fixture shift ${shiftId} was not updated`);
    return shift;
  }

  async function createSealedSegmentEvidence(
    request: APIRequestContext,
    shiftId: string,
    keyPrefix: string,
    shiftInterval: { planned_start_at: Date; planned_end_at: Date },
  ) {
    const priorReadingRows = await client.unsafe<{ reading_value: string }[]>(`
      select reading_value
      from app.meter_boundaries
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and nozzle_id='${ids.nozzle}' and meter_installation_id='${ids.installation}'
        and reading_status='AVAILABLE'
      order by effective_at desc, id desc
      limit 1
    `);
    const openingReading = priorReadingRows[0]?.reading_value ?? '100000.000';
    const closingReading = new ExactDecimal(openingReading)
      .add(new ExactDecimal('500.000'))
      .toString();
    const openingBoundaryId = randomUUID();
    const closingBoundaryId = randomUUID();
    const segmentId = randomUUID();

    await command(
      request,
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.station,
        boundaryId: openingBoundaryId,
        nozzleId: ids.nozzle,
        meterInstallationId: ids.installation,
        businessDayId: ids.day,
        shiftId,
        responsibleAttendantId: ids.attendantMembership,
        reason: 'SHIFT_OPEN',
        readingStatus: 'AVAILABLE',
        readingValue: openingReading,
        exceptionReason: 'A12.1 Playwright canonical opening evidence',
        expectedVersion: 0,
      },
      `${keyPrefix}-opening-${openingBoundaryId}`,
    );
    await client.unsafe('select pg_sleep(0.01)');
    await command(
      request,
      {
        commandType: 'ConfirmBoundary',
        tenantId: ids.tenant,
        stationId: ids.station,
        boundaryId: closingBoundaryId,
        nozzleId: ids.nozzle,
        meterInstallationId: ids.installation,
        businessDayId: ids.day,
        shiftId,
        responsibleAttendantId: ids.attendantMembership,
        reason: 'SHIFT_CLOSE',
        readingStatus: 'AVAILABLE',
        readingValue: closingReading,
        expectedVersion: 0,
      },
      `${keyPrefix}-closing-${closingBoundaryId}`,
    );
    const boundaryRows = await client.unsafe<{ id: string; effective_at: Date }[]>(`
      select id, effective_at
      from app.meter_boundaries
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and id in ('${openingBoundaryId}', '${closingBoundaryId}')
      order by effective_at, id
    `);
    expect(boundaryRows).toHaveLength(2);
    const openingBoundary = boundaryRows.find((boundary) => boundary.id === openingBoundaryId);
    const closingBoundary = boundaryRows.find((boundary) => boundary.id === closingBoundaryId);
    if (!openingBoundary || !closingBoundary) {
      throw new Error('The canonical boundary evidence could not be reloaded');
    }
    expect(openingBoundary.effective_at.getTime()).toBeLessThan(
      closingBoundary.effective_at.getTime(),
    );
    expect(openingBoundary.effective_at.getTime()).toBeGreaterThanOrEqual(
      shiftInterval.planned_start_at.getTime(),
    );
    expect(closingBoundary.effective_at.getTime()).toBeLessThanOrEqual(
      shiftInterval.planned_end_at.getTime(),
    );
    await command(
      request,
      {
        commandType: 'SealSegment',
        tenantId: ids.tenant,
        stationId: ids.station,
        segmentId,
        nozzleId: ids.nozzle,
        meterInstallationId: ids.installation,
        businessDayId: ids.day,
        shiftId,
        openingBoundaryId,
        closingBoundaryId,
        productId: ids.product,
        responsibleAttendantId: ids.attendantMembership,
        startAt: openingBoundary.effective_at.toISOString(),
        endAt: closingBoundary.effective_at.toISOString(),
        expectedVersion: 0,
      },
      `${keyPrefix}-segment-${segmentId}`,
    );

    return { openingReading, closingReading, segmentId };
  }

  test('A11 control room exposes authorized actions, station time, restricted audit, and mobile keyboard access', async ({
    context,
    page,
  }) => {
    // beforeAll intentionally preserves existing rows on conflict. Restore this
    // fixed shift because the reconciliation scenario retimes it around now().
    await client.unsafe(`
      update app.shifts
      set planned_start_at = '2026-09-23T06:00:00Z',
          planned_end_at = '2026-09-23T14:00:00Z'
      where tenant_id = '${ids.tenant}'
        and station_id = '${ids.station}'
        and id = '${ids.shift}'
    `);
    await authenticate(context, supervisorToken);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAndWaitForHydration(
      page,
      `/operations/daily?${new URLSearchParams({
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId: ids.day,
      })}`,
    );

    const controlRoom = page.locator('[aria-label="Operations control room"]');
    // This scenario runs with CI's Better Auth provider. Rendering the control
    // room must not require a ClerkProvider or crash before its content loads.
    await expect(controlRoom).toBeVisible({ timeout: 30_000 });
    await expect(controlRoom.getByRole('heading', { name: 'Shifts', exact: true })).toBeVisible();
    await expect(controlRoom.getByRole('button', { name: 'Close meters' }).first()).toBeVisible();
    await expect(controlRoom.getByRole('button', { name: 'Lock business day' })).toHaveCount(0);
    await expect(controlRoom.getByText('Audit history restricted')).toBeVisible();
    await expect(
      controlRoom
        .locator('article.operations-shift-row strong')
        .filter({
          hasText: 'Morning · 08:00–16:00',
        })
        .first(),
    ).toBeVisible();

    const closeMeters = controlRoom.getByRole('button', { name: 'Close meters' }).first();
    await expect(async () => {
      await closeMeters.focus();
      await expect(closeMeters).toBeFocused();
    }).toPass({ timeout: 10_000 });

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.documentWidth).toBe(layout.viewportWidth);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test('A11 control room refreshes and explains a stale shift action without retrying it', async ({
    context,
    page,
  }) => {
    const staleShift = randomUUID();
    await client`insert into app.shifts (id,tenant_id,station_id,business_day_id,state,planned_start_at,planned_end_at,business_date) values (${staleShift},${ids.tenant},${ids.station},${ids.day},'PLANNED','2026-09-23T06:00:00Z','2026-09-23T14:00:00Z','2026-09-23')`;
    await authenticate(context, supervisorToken);
    await gotoAndWaitForHydration(
      page,
      `/operations/daily?${new URLSearchParams({
        tenantId: ids.tenant,
        stationId: ids.station,
        businessDayId: ids.day,
      })}`,
    );

    const shiftRow = page
      // The approved layout no longer prints raw shift ids; rows carry data-shift-id.
      .locator(`article.operations-shift-row[data-shift-id="${staleShift}"]`);
    const closeMeters = shiftRow.getByRole('button', { name: 'Start shift' });
    await expect(closeMeters).toBeVisible();
    await client.unsafe(`update app.shifts set version = version + 1 where id = '${staleShift}'`);

    page.once('dialog', (dialog) => void dialog.accept());
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/forecourt/commands') &&
        response.request().method() === 'POST',
    );
    await closeMeters.click();
    await page
      .getByRole('alertdialog', { name: 'Start shift?', exact: true })
      .getByRole('button', { name: 'Start shift', exact: true })
      .click();
    const response = await responsePromise;
    expect(response.status()).toBe(409);
    await expect(page.getByText('This was updated by someone else', { exact: true })).toBeVisible();
    await expect(page.getByText(/we’ve loaded the latest version/i)).toBeVisible();
  });

  test('persists through refresh, submits, approves, and rejects edits after production approval', async ({
    context,
    page,
  }, testInfo) => {
    const activeShiftId =
      [ids.shift, ids.retryShift, ids.retryShiftTwo, ids.retryShiftThree][testInfo.retry] ??
      ids.retryShiftThree;
    const reconciliationId = crypto.randomUUID();
    const query = new URLSearchParams({
      tenantId: ids.tenant,
      businessDayId: ids.day,
      shiftId: activeShiftId,
      reconciliationId,
    });
    const supervisorUrl = `/stations/${ids.station}/reconciliations/new?${query}`;
    const reviewUrl = `/stations/${ids.station}/reconciliations/${reconciliationId}/review?${query.toString().replace(`reconciliationId=${reconciliationId}&`, '')}`;

    await authenticate(context, supervisorToken);
    const shiftInterval = await prepareFixtureShift(activeShiftId);
    const sealedEvidence = await createSealedSegmentEvidence(
      page.request,
      activeShiftId,
      `a5e-${reconciliationId}`,
      shiftInterval,
    );
    await gotoAndWaitForHydration(page, supervisorUrl);
    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/forecourt/commands') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create draft' }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    await expect
      .poll(
        async () =>
          (
            await page.request.get(
              `/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
            )
          ).status(),
        { timeout: 10_000 },
      )
      .toBe(200);
    await page.reload();
    await expect(
      page.locator('[aria-label="Production daily reconciliation workflow"]'),
    ).toBeVisible();

    const common = {
      tenantId: ids.tenant,
      stationId: ids.station,
      reconciliationId,
    };
    await command(
      page.request,
      {
        commandType: 'SaveMeterReadings',
        ...common,
        expectedVersion: 0,
        readings: [
          {
            nozzleId: ids.nozzle,
            productId: ids.product,
            shiftId: activeShiftId,
            openingReading: sealedEvidence.openingReading,
            closingReading: sealedEvidence.closingReading,
            sellingPriceId: ids.price,
          },
        ],
      },
      `a5e-readings-${reconciliationId}`,
    );
    await command(
      page.request,
      {
        commandType: 'SavePaymentAllocations',
        ...common,
        expectedVersion: 1,
        payments: [{ method: 'CASH', amount: '750.0000' }],
      },
      `a5e-payments-${reconciliationId}`,
    );
    await command(
      page.request,
      { commandType: 'SaveExpenses', ...common, expectedVersion: 2, expenses: [] },
      `a5e-expenses-${reconciliationId}`,
    );

    await page.reload();
    await expect(page.getByText('500.000', { exact: true })).toBeVisible();
    await expect(page.getByText(/750(?:\.0+)? USD/).first()).toBeVisible();
    await page.getByLabel('Cash counted').fill('750.0000');
    await page.getByRole('button', { name: 'Save persisted draft' }).click();
    await expect(page.getByLabel('Cash counted')).toHaveValue(/750/);

    await page.getByRole('button', { name: 'Submit for management review' }).click();
    await expect(page.getByText('SUBMITTED', { exact: true })).toBeVisible();

    await authenticate(context, managerToken);
    // Shell hydration precedes the review's authoritative data requests.
    const reviewRecord = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes(`/api/forecourt/reconciliations/${reconciliationId}?`),
    );
    await gotoAndWaitForHydration(page, reviewUrl);
    const loadedRecord = await reviewRecord;
    expect(loadedRecord.status()).toBe(200);
    expect((await loadedRecord.json()).state).toBe('SUBMITTED');
    await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
    const approveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/forecourt/commands') &&
        response.request().method() === 'POST',
    );
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Approve production reconciliation' }).click();
    await verifyApproval(page);
    await page
      .getByRole('alertdialog', { name: 'Approve these figures?', exact: true })
      .getByRole('button', { name: 'Approve', exact: true })
      .click();
    const approveResponse = await approveResponsePromise;
    expect(approveResponse.status()).toBe(200);
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
          );
          return ((await response.json()) as { state: string }).state;
        },
        { timeout: 10_000 },
      )
      .toBe('APPROVED');
    await gotoAndWaitForHydration(page, supervisorUrl);
    await page.reload();
    await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'Approved records have posted canonical sale evidence. Further changes require a named correction workflow.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save persisted draft' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit for management review' })).toHaveCount(0);
    await expect(page.getByLabel('Cash counted')).toBeDisabled();
    await expect(page.getByLabel('Variance explanation')).toBeDisabled();
    const accessibility = await new AxeBuilder({ page })
      .include('[aria-label="Production daily reconciliation workflow"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);

    const approvedRead = await page.request.get(
      `/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
    );
    const approvedBody = (await approvedRead.json()) as { version: number; state: string };
    expect(approvedBody.state).toBe('APPROVED');

    await authenticate(context, supervisorToken);
    const lockedWrite = await page.request.post('/api/forecourt/commands', {
      data: {
        commandType: 'SaveReconciliationDraft',
        ...common,
        expectedVersion: approvedBody.version,
      },
      headers: { 'idempotency-key': `a5e-locked-write-${reconciliationId}` },
    });
    expect(lockedWrite.status()).toBe(409);
    expect((await lockedWrite.json()).error).toBe('CONFLICT');

    const movements = await client.unsafe<
      { source_type: string; source_id: string; movement_type: string; quantity_litres: string }[]
    >(`
      select source_type, source_id, movement_type, quantity_litres::text as quantity_litres
      from app.inventory_movements
      where tenant_id='${ids.tenant}' and station_id='${ids.station}'
        and source_type='METER_SEGMENT_SALE' and source_id='${sealedEvidence.segmentId}'
    `);
    expect(movements).toEqual([
      {
        source_type: 'METER_SEGMENT_SALE',
        source_id: sealedEvidence.segmentId,
        movement_type: 'SALE',
        quantity_litres: '-500.000',
      },
    ]);
  });

  test('integrated owner workflow uses Close Meters, fixed payments and secure review', async ({
    context,
    page,
  }) => {
    test.setTimeout(180_000);
    const shiftId = ids.a11RetryShift;
    const { secondAttendant } = await seedSecondNozzle(client);
    await authenticate(context, supervisorToken);
    await prepareFixtureShift(shiftId);
    // This synthetic shift follows the previous scenario's recorded boundaries.
    // Overlapping fixture intervals must not hide its authoritative opening reading.
    await client`update app.shifts set planned_start_at=(select coalesce(max(effective_at)+interval '1 millisecond',now()-interval '5 minutes') from app.meter_boundaries where tenant_id=${ids.tenant} and station_id=${ids.station}) where id=${shiftId}`;
    const query = new URLSearchParams({
      tenantId: ids.tenant,
      stationId: ids.station,
      businessDayId: ids.day,
      shiftId,
    });
    await gotoAndWaitForHydration(
      page,
      `/operations/daily?tenantId=${ids.tenant}&stationId=${ids.station}&businessDayId=${ids.day}`,
    );
    const row = page.locator(`article.operations-shift-row[data-shift-id="${shiftId}"]`);
    await row.getByRole('button', { name: 'Close meters', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Close meters', exact: true });
    await expect(sheet.getByLabel('Responsible attendant')).toHaveCount(2);
    await sheet.getByLabel('Responsible attendant').nth(0).selectOption(ids.attendantMembership);
    await sheet.getByLabel('Responsible attendant').nth(1).selectOption(secondAttendant);
    for (const input of await sheet.getByLabel('Opening reading', { exact: true }).all())
      await input.fill('100000');
    const meterContextResponse = await page.request.get(`/api/forecourt/operations/daily?${query}`);
    const meterContext = await meterContextResponse.json();
    for (const nozzle of meterContext.availableReadings as Array<{
      nozzleId: string;
      previousReading: string | null;
    }>) {
      await sheet
        .locator(`#close-${nozzle.nozzleId}`)
        .fill(
          new ExactDecimal(nozzle.previousReading ?? '100000')
            .add(new ExactDecimal('250'))
            .toString(),
        );
    }
    let lostSeal = false;
    let firstSealBody: string | null = null;
    let firstSealKey: string | undefined;
    await page.route('**/api/forecourt/commands', async (route) => {
      const request = route.request();
      if (request.postDataJSON()?.commandType !== 'SealSegment') {
        await route.continue();
        return;
      }
      if (!lostSeal) {
        firstSealBody = request.postData();
        firstSealKey = request.headers()['idempotency-key'];
        const response = await route.fetch();
        expect(response.ok(), await response.text()).toBe(true);
        lostSeal = true;
        await route.abort('connectionreset');
        return;
      }
      if (request.headers()['idempotency-key'] === firstSealKey)
        expect(request.postData()).toBe(firstSealBody);
      await route.continue();
    });
    await sheet.getByRole('button', { name: 'Close meters', exact: true }).click();
    await expect(
      sheet.getByRole('button', { name: 'Retry close meters', exact: true }),
    ).toBeEnabled();
    await expect(sheet.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await expect(sheet.getByLabel('Responsible attendant').first()).toBeDisabled();
    await page.reload();
    await row.getByRole('button', { name: 'Close meters', exact: true }).click();
    await sheet.getByRole('button', { name: 'Retry close meters', exact: true }).click();
    await expect(sheet).not.toBeVisible({ timeout: 30000 });
    await page.unroute('**/api/forecourt/commands');
    const [shift] = await client`select state from app.shifts where id=${shiftId}`;
    expect(shift?.state).toBe('COMPLETED');
    const segments =
      await client`select litres::text, attendant_id from app.meter_segments where shift_id=${shiftId}`;
    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.attendant_id).sort()).toEqual(
      [ids.attendantMembership, secondAttendant].sort(),
    );
    expect(segments.every((segment) => new ExactDecimal(segment.litres).toString() === '250')).toBe(
      true,
    );
    await gotoAndWaitForHydration(page, `/operations/daily?${query}`);
    await page.getByRole('checkbox', { name: /A5 E2E Attendant/ }).check();
    await page.getByRole('checkbox', { name: /Integration Attendant Two/ }).check();
    const steps = page.getByRole('navigation', { name: 'Steps', exact: true });
    await steps.getByRole('button', { name: /Payments/ }).click();
    await page.getByLabel('Cash amount', { exact: true }).fill('500.0000');
    await page.getByLabel('EcoCash amount', { exact: true }).fill('150.0000');
    await page.getByLabel('Card (POS) amount', { exact: true }).fill('100.0000');
    await steps.getByRole('button', { name: /Cash/ }).click();
    await page.getByLabel('Cash counted', { exact: true }).fill('500.0000');
    await steps.getByRole('button', { name: /Submit/ }).click();
    await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: 'Submit for review?', exact: true })
      .getByRole('button', { name: 'Submit', exact: true })
      .click();
    await expect(page.getByText('Submitted for review', { exact: true }).first()).toBeVisible();
    const reconciliationId = new URL(page.url()).searchParams.get('reconciliationId')!;
    const response = await page.request.get(
      `/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
    );
    const record = await response.json();
    expect(record.state).toBe('SUBMITTED');
    expect(record.submitted_by).toBe(ids.supervisorMembership);
    expect(new ExactDecimal(record.totals.expectedSales).toString()).toBe('750');
    expect(new ExactDecimal(record.totals.accountedSales).toString()).toBe('750');
    expect(new ExactDecimal(record.totals.salesVariance).toString()).toBe('0');
    const denied = await page.request.post('/api/forecourt/commands', {
      data: {
        commandType: 'ApproveProductionReconciliation',
        tenantId: ids.tenant,
        stationId: ids.station,
        reconciliationId,
        expectedVersion: record.version,
      },
      headers: { 'idempotency-key': `denied-${randomUUID()}` },
    });
    expect(denied.status()).toBe(403);
    const otherStation = randomUUID();
    await client`insert into app.stations (id,tenant_id,legal_entity_id,code,name,status,timezone) values (${otherStation},${ids.tenant},${ids.legal},'ISOLATED','Other synthetic station','ACTIVE','Africa/Harare')`;
    const isolated = await page.request.get(
      `/api/forecourt/operations/daily?tenantId=${ids.tenant}&stationId=${otherStation}&businessDayId=${ids.day}&shiftId=${shiftId}`,
    );
    expect(isolated.status()).toBe(403);
    await authenticate(context, managerToken);
    const inventoryBeforeDenial = await client`
      select id, quantity_litres::text from app.inventory_movements
      where tenant_id=${ids.tenant} and station_id=${ids.station} order by id
    `;
    // auth.session uses timestamp without time zone and the application maps it
    // as a UTC Date.  Write a UTC wall-clock value so this fixture is expired
    // from the application's perspective even when PostgreSQL uses a non-UTC
    // session timezone.
    await client`update auth.session set step_up_expires_at=timezone('UTC', now())-interval '1 second' where user_id=${ids.managerActor}`;
    const noStepUp = await page.request.post('/api/forecourt/commands', {
      data: {
        commandType: 'ApproveProductionReconciliation',
        tenantId: ids.tenant,
        stationId: ids.station,
        reconciliationId,
        expectedVersion: record.version,
      },
      headers: { 'idempotency-key': `mfa-required-${randomUUID()}` },
    });
    expect(noStepUp.status()).toBe(403);
    const [deniedState] = await client`
      select state from app.reconciliations where id=${reconciliationId}
    `;
    expect(deniedState?.state).toBe('SUBMITTED');
    const [deniedPostings] = await client`
      select count(*)::int as count from app.sale_recognition_movements
      where reconciliation_id=${reconciliationId}
    `;
    expect(deniedPostings?.count).toBe(0);
    expect(
      await client`
      select id, quantity_litres::text from app.inventory_movements
      where tenant_id=${ids.tenant} and station_id=${ids.station} order by id
    `,
    ).toEqual(inventoryBeforeDenial);
    await gotoAndWaitForHydration(
      page,
      `/operations/reconciliations/${reconciliationId}/review?${query}`,
    );
    await page.getByRole('button', { name: 'Send back', exact: true }).click();
    const returnDialog = page.getByRole('alertdialog', {
      name: 'Send back for correction?',
      exact: true,
    });
    await expect(
      returnDialog.getByRole('button', { name: 'Send back', exact: true }),
    ).toBeDisabled();
    await returnDialog
      .getByLabel('Return reason')
      .fill('Please verify the recorded cash evidence.');
    await returnDialog.getByRole('button', { name: 'Send back', exact: true }).click();
    await expect(page.getByText('Returned', { exact: true }).first()).toBeVisible();
    await authenticate(context, supervisorToken);
    await gotoAndWaitForHydration(
      page,
      `/operations/daily?${query}&reconciliationId=${reconciliationId}`,
    );
    await page
      .getByRole('navigation', { name: 'Steps', exact: true })
      .getByRole('button', { name: /Payments/ })
      .click();
    await expect(page.getByLabel('Cash amount', { exact: true })).toHaveValue('500.0000');
    await expect(page.getByLabel('EcoCash amount', { exact: true })).toHaveValue('150.0000');
    await expect(page.getByLabel('Card (POS) amount', { exact: true })).toHaveValue('100.0000');
    await page
      .getByRole('navigation', { name: 'Steps', exact: true })
      .getByRole('button', { name: /Submit/ })
      .click();
    await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: 'Submit for review?', exact: true })
      .getByRole('button', { name: 'Submit', exact: true })
      .click();
    await expect(page.getByText('Submitted for review', { exact: true }).first()).toBeVisible();
    await authenticate(context, managerToken);
    await gotoAndWaitForHydration(
      page,
      `/operations/reconciliations/${reconciliationId}/review?${query}`,
    );
    await page
      .getByRole('button', { name: 'Approve production reconciliation', exact: true })
      .click();
    await verifyApproval(page);
    await page
      .getByRole('alertdialog', { name: 'Approve these figures?', exact: true })
      .getByRole('button', { name: 'Approve', exact: true })
      .click();
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
    const final = await page.request.get(
      `/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ids.tenant}&stationId=${ids.station}`,
    );
    const approved = await final.json();
    expect(approved.state).toBe('APPROVED');
    const [approvedState] = await client`
      select state, approved_by from app.reconciliations where id=${reconciliationId}
    `;
    expect(approvedState).toEqual({ state: 'APPROVED', approved_by: ids.managerMembership });
    await page.reload();
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Approve production reconciliation', exact: true }),
    ).toHaveCount(0);
    const accessibility = await new AxeBuilder({ page })
      .include('[aria-label="Reconciliation review"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);
    const movements =
      await client`select quantity_litres::text from app.inventory_movements where tenant_id=${ids.tenant} and station_id=${ids.station} and source_type='METER_SEGMENT_SALE' and source_id in (select id from app.meter_segments where shift_id=${shiftId})`;
    expect(movements).toHaveLength(2);
    expect(movements.every((movement) => movement.quantity_litres === '-250.000')).toBe(true);
    const [approvalPostings] = await client`
      select count(*)::int as count from app.sale_recognition_movements
      where reconciliation_id=${reconciliationId}
    `;
    expect(approvalPostings?.count).toBe(2);
    const [approvalAudit] = await client`
      select count(*)::int as count from platform.security_events
      where tenant_id=${ids.tenant}
        and event_code='FORECOURT.ApproveProductionReconciliation'
        and membership_id=${ids.managerMembership}
        and details->>'subjectId'=${reconciliationId}
    `;
    expect(approvalAudit?.count).toBe(1);
    await authenticate(context, supervisorToken);
    const locked = await page.request.post('/api/forecourt/commands', {
      data: {
        commandType: 'SaveReconciliationDraft',
        tenantId: ids.tenant,
        stationId: ids.station,
        reconciliationId,
        expectedVersion: approved.version,
      },
      headers: { 'idempotency-key': `locked-${randomUUID()}` },
    });
    expect(locked.status()).toBe(409);
  });
});
