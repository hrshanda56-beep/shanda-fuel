import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Cash handover, activity log, document attachments and reminder settings, driven against sample
 * API answers so no Clerk user or database is needed. They check what a person sees and presses;
 * the server rules are covered by the integration tests.
 */

const tenantId = 'e2e90000-0000-4000-8000-000000000001';

const auditItem = (id: string, action: string, changes: unknown[] = [], created = false) => ({
  id,
  occurredAt: '2026-10-21T08:30:00.000Z',
  who: 'Rudo Chikwanha',
  action,
  area: 'Supplier',
  subject: 'Supplier 11111111…',
  reason: null,
  changes,
  created,
});

async function mockApi(page: Page) {
  const posted: Array<Record<string, unknown>> = [];
  const uploads: string[] = [];
  const settings = {
    settings: {
      dueSoonDays: 7,
      posSettlementLagDays: 3,
      reportGraceDays: 1,
      cashShortageMinimum: '0.01',
    },
    version: null as number | null,
    canManage: true,
  };
  await page.route('**/api/cash/commands', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    posted.push(body);
    await route.fulfill({
      status: 201,
      json: { handoverId: 'new', state: 'SUBMITTED', version: 0 },
    });
  });
  await page.route('**/api/audit/events**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('after')) {
      await route.fulfill({
        json: { items: [auditItem('e3', 'Cash: accept cash handover')], next: null },
      });
      return;
    }
    await route.fulfill({
      json: {
        items: [
          auditItem('e1', 'Supplier: credit limit set', [
            { field: 'Credit limit', before: '1000', after: '2000' },
          ]),
          auditItem(
            'e2',
            'Cash: submit cash handover',
            [{ field: 'Amount', before: null, after: '50' }],
            true,
          ),
        ],
        next: 'cursor',
      },
    });
  });
  await page.route('**/api/documents/*', async (route) => {
    await route.fulfill({
      json: { downloadUrl: 'https://storage.invalid/file', expiresInSeconds: 300 },
    });
  });
  await page.route(/\/api\/documents(\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      uploads.push(route.request().postData() ?? '');
      await route.fulfill({ status: 201, json: { documentId: 'new' } });
      return;
    }
    await route.fulfill({
      json: {
        canUpload: true,
        items: [
          {
            documentId: 'd1',
            kind: 'DELIVERY_NOTE',
            fileName: 'note.pdf',
            byteSize: 312 * 1024,
            uploadedAt: '2026-10-21T08:00:00Z',
            uploadedByName: 'Tendai Moyo',
          },
        ],
      },
    });
  });
  await page.route('**/api/setup/alert-settings**', async (route) => {
    await route.fulfill({ json: settings });
  });
  await page.route('**/api/setup/commands', async (route) => {
    posted.push(route.request().postDataJSON() as Record<string, unknown>);
    settings.version = 0;
    await route.fulfill({ json: { version: 0 } });
  });
  return { posted, uploads };
}

test.describe('New v1 screens', () => {
  test('lets a receiver accept cash and shows what is waiting in plain words', async ({ page }) => {
    const { posted } = await mockApi(page);
    await page.goto('/dev-preview/v1-panels');
    const waiting = page.getByRole('list', { name: 'Handovers waiting for action' });
    await expect(waiting.getByText('Waiting to be accepted')).toBeVisible();
    await expect(waiting.getByText('Does not add up')).toBeVisible();
    await expect(
      waiting.getByText('Tendai Moyo handed cash from Station till to Station safe.').first(),
    ).toBeVisible();
    await expect(waiting.getByText('Reason given: Customer was short-changed')).toBeVisible();

    await waiting.getByRole('button', { name: 'I received this cash' }).click();
    await expect(page.getByText('Cash accepted.')).toBeVisible();
    expect(posted[0]).toMatchObject({
      commandType: 'AcceptCashHandover',
      handoverId: 'h1',
      expectedVersion: 0,
    });
  });

  test('asks why a count is different, and settles a disputed handover with a note', async ({
    page,
  }) => {
    const { posted } = await mockApi(page);
    await page.goto('/dev-preview/v1-panels');
    await page.getByLabel('Cash is coming from').selectOption({ label: 'Station till' });
    await page.getByLabel('Handing it to').selectOption({ label: 'Station safe' });
    await page.getByLabel('Amount that should be handed over').fill('100');
    await page.getByLabel('Amount you actually counted').fill('90');
    await expect(page.getByLabel('Why is it different?')).toBeVisible();
    await page.getByLabel('Why is it different?').fill('Till was short');
    await page.getByRole('button', { name: 'Hand over cash' }).click();
    await expect(page.getByText(/now needs to accept it/)).toBeVisible();
    expect(posted[0]).toMatchObject({
      commandType: 'SubmitCashHandover',
      expectedAmount: '100',
      countedAmount: '90',
      reason: 'Till was short',
    });

    await page.getByRole('button', { name: 'Settle' }).click();
    const save = page.getByRole('button', { name: 'Save and settle' });
    await expect(save).toBeDisabled();
    await page.getByLabel('How was this settled?').fill('Recovered from payroll');
    await save.click();
    await expect(page.getByText('Handover settled.')).toBeVisible();
    expect(posted.at(-1)).toMatchObject({
      commandType: 'ResolveCashHandover',
      resolutionNote: 'Recovered from payroll',
    });
  });

  test('shows the activity log with what changed, and loads older entries', async ({ page }) => {
    await mockApi(page);
    await page.goto('/dev-preview/v1-panels');
    const log = page.getByRole('list', { name: 'Recent changes' });
    await expect(log.getByText('Supplier: credit limit set')).toBeVisible();
    await log.getByRole('button', { name: 'What changed' }).click();
    await expect(log.getByText('Credit limit', { exact: true })).toBeVisible();
    await expect(log.getByText('1000')).toBeVisible();
    await expect(log.getByText('2000')).toBeVisible();
    await log.getByRole('button', { name: 'What was recorded' }).click();
    await expect(log.getByText('50', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show older changes' }).click();
    await expect(log.getByText('Cash: accept cash handover')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show older changes' })).toHaveCount(0);
  });

  test('lists documents, uploads a file and opens one through a short-lived link', async ({
    page,
  }) => {
    const { uploads } = await mockApi(page);
    await page.goto('/dev-preview/v1-panels');
    const docs = page.getByRole('region', { name: 'Delivery note and photos' });
    await expect(docs.getByText('Delivery note: note.pdf')).toBeVisible();
    await expect(docs.getByText(/312 KB · added by Tendai Moyo/)).toBeVisible();

    await docs.getByRole('button', { name: 'Add file' }).click();
    await expect(docs.getByText('Choose a file first.')).toBeVisible();

    await docs.getByLabel('File').setInputFiles({
      name: 'slip.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    });
    await docs.getByRole('button', { name: 'Add file' }).click();
    await expect.poll(() => uploads.length).toBe(1);
    expect(uploads[0]).toContain('name="subjectType"');
    expect(uploads[0]).toContain('FUEL_DELIVERY');
    expect(uploads[0]).toContain('filename="slip.pdf"');

    await page
      .context()
      .route('https://storage.invalid/**', (route) => route.fulfill({ body: 'ok' }));
    const popup = page.waitForEvent('popup');
    await docs.getByRole('button', { name: /Delivery note: note\.pdf/ }).click();
    expect((await popup).url()).toContain('storage.invalid');
  });

  test('explains the reminder settings, checks the numbers, and saves them', async ({ page }) => {
    const { posted } = await mockApi(page);
    await page.goto('/dev-preview/v1-panels');
    await expect(page.getByText(/starting values apply/)).toBeVisible();
    await page.getByLabel(/Warn about supplier invoices due within/).fill('0');
    await page.getByRole('button', { name: 'Save reminders' }).click();
    await expect(
      page.getByText('enter a number of days from 1 to 60', { exact: false }),
    ).toBeVisible();
    expect(posted).toHaveLength(0);

    await page.getByLabel(/Warn about supplier invoices due within/).fill('10');
    await page.getByRole('button', { name: 'Save reminders' }).click();
    await expect(page.getByText('Reminders will use these numbers from now on.')).toBeVisible();
    expect(posted[0]).toMatchObject({
      commandType: 'SetAlertSettings',
      tenantId,
      dueSoonDays: 10,
      posSettlementLagDays: 3,
      reportGraceDays: 1,
      cashShortageMinimum: '0.01',
    });
    expect(posted[0]).not.toHaveProperty('expectedVersion');
  });

  for (const width of [320, 390, 768, 1280]) {
    test(`fits the screen and passes accessibility checks at ${width}px`, async ({ page }) => {
      await mockApi(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dev-preview/v1-panels');
      await expect(page.getByText('Delivery note: note.pdf')).toBeVisible();
      await expect(page.getByText('Supplier: credit limit set')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
