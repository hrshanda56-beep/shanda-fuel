import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The ZERA monthly return wizard, hosted alone on a development page with no sign-in. The API
 * answers are sample data, so these tests check the questions, the plain messages, the check screen,
 * what would be saved, and the download. The figures themselves, permissions and saving are covered
 * by the unit and integration tests.
 */

const tenantId = 'e2e90000-0000-4000-8000-000000000001';
const stationId = 'e2e90000-0000-4000-8000-000000000021';

const emptyDetails = {
  licenceNumber: null,
  licenceHolder: null,
  ownership: null,
  province: null,
  representativeName: null,
  representativePhone: null,
  representativeEmail: null,
};
const fullDetails = {
  licenceNumber: 'L-77',
  licenceHolder: 'Main Oils (Pvt) Ltd',
  ownership: 'COCO',
  province: 'Harare',
  representativeName: 'Tendai Moyo',
  representativePhone: '+263 77 123 4567',
  representativeEmail: 'tendai@example.com',
};

type Over = {
  details?: typeof emptyDetails | typeof fullDetails;
  petrol?: { supplied: string; sold: string };
  ethanolPercent?: number | null;
  missingDays?: string[];
  blockers?: { productId: string; productName: string }[];
};

function view(over: Over = {}) {
  const details = over.details ?? emptyDetails;
  const missingDays = over.missingDays ?? [];
  return {
    tenantId,
    stationId,
    stationName: 'Main Station',
    stationTimezone: 'Africa/Harare',
    month: '2026-10',
    periodEnd: '2026-10-31',
    details,
    missingDetails: [],
    result: {
      diesel50: { supplied: '10000', sold: missingDays.length ? 'm' : '6786' },
      // As the real figures do: one unapproved day makes both sold boxes `m`.
      petrol: {
        ...(over.petrol ?? { supplied: '0', sold: '0' }),
        ...(missingDays.length ? { sold: 'm' } : {}),
      },
      ethanolPercent: over.ethanolPercent === undefined ? null : over.ethanolPercent,
      ethanolChoices: [],
      blockers: over.blockers ?? [],
      missingDays,
      notes: missingDays.length
        ? [{ code: 'MISSING_DAYS', text: `Sold litres are marked m: ${missingDays.join(', ')}.` }]
        : [],
    },
  };
}

type Captured = { saves: Record<string, unknown>[]; downloads: number; stepUps: number };

async function mock(page: Page, body: ReturnType<typeof view>): Promise<Captured> {
  const seen: Captured = { saves: [], downloads: 0, stepUps: 0 };
  await page.route('**/api/reports/zera?**', (route) => route.fulfill({ json: body }));
  await page.route('**/api/reports/zera/saved**', async (route) => {
    if (route.request().method() === 'POST') {
      const posted = route.request().postDataJSON() as Record<string, unknown>;
      seen.saves.push(posted);
      return route.fulfill({
        json: { id: 'r1', version: 1, month: '2026-10', answers: [] },
      });
    }
    return route.fulfill({
      json: [{ id: 'r1', month: '2026-10', version: 1, savedAt: '2026-11-21 08:00:00+00' }],
    });
  });
  await page.route('**/api/auth/step-up', (route) => {
    seen.stepUps += 1;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/reports/zera/download**', (route) => {
    seen.downloads += 1;
    // The first attempt asks for the identity check; the retry after it succeeds.
    if (seen.downloads === 1) {
      return route.fulfill({
        status: 403,
        json: { message: 'Step-up authentication is required.' },
      });
    }
    return route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/csv',
        'content-disposition': 'attachment; filename="zera-return-2026-10-v1.csv"',
      },
      body: 'Question,Answer\r\n',
    });
  });
  return seen;
}

const next = (page: Page) => page.getByRole('button', { name: /^Continue/ });
const heading = (page: Page, name: RegExp | string) =>
  expect(page.getByRole('heading', { name })).toBeVisible();

async function startOctober(page: Page) {
  await page.goto('/dev-preview/zera-return');
  await heading(page, 'Which month is the return for?');
  await page.getByLabel('Month').selectOption('2026-10');
  await next(page).click();
}

test.describe('ZERA monthly return wizard', () => {
  test('asks each licence question once, checks each answer, and saves exactly what was entered', async ({
    page,
  }) => {
    const seen = await mock(
      page,
      view({ petrol: { supplied: '5000', sold: '5128' }, missingDays: ['2026-10-04'] }),
    );
    await startOctober(page);

    await heading(page, 'What name is on the licence?');
    await next(page).click();
    await expect(page.getByText('Enter the name exactly as it is on the licence.')).toBeVisible();
    await page.getByLabel('Name on the licence').fill('Main Oils (Pvt) Ltd');
    await next(page).click();

    await heading(page, 'What is the licence number?');
    await next(page).click();
    await expect(page.getByText('Enter the licence number.')).toBeVisible();
    await page.getByLabel('Licence number').fill('L-77');
    await next(page).click();

    await heading(page, 'Who owns and runs the station?');
    await next(page).click();
    await expect(page.getByText('Choose one.')).toBeVisible();
    await page.getByText('COCO', { exact: true }).click();
    await next(page).click();

    await heading(page, 'Which province is the station in?');
    await next(page).click();
    await expect(page.getByText('Choose the province.')).toBeVisible();
    await page.getByLabel('Province').selectOption('Harare');
    await next(page).click();

    await heading(page, 'Who should ZERA contact?');
    await next(page).click();
    await expect(page.getByText(/Enter the name of the person ZERA should contact/)).toBeVisible();
    await expect(page.getByText(/Enter a phone number/)).toBeVisible();
    await expect(page.getByText(/Enter an email address/)).toBeVisible();
    await page.getByLabel('Name').fill('Tendai Moyo');
    await page.getByLabel('Phone number').fill('+263 77 123 4567');
    await page.getByLabel('Email address').fill('not-an-email');
    await next(page).click();
    await expect(page.getByText(/Enter an email address/)).toBeVisible();
    await page.getByLabel('Email address').fill('tendai@example.com');
    await next(page).click();

    // Petrol moved and no blend is on record, so the percentage is asked.
    await heading(page, 'What is the ethanol percentage of your blended petrol?');
    await next(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Choose one.' })).toBeVisible();
    await page.getByText('10%', { exact: true }).click();
    await next(page).click();

    // A day with no approved report is explained, never hidden.
    await heading(page, 'Something needs your attention');
    await expect(page.getByText(/2026-10-04/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Continue with m' }).click();

    await heading(page, 'Anything to add in the notes?');
    await page.getByLabel('Notes').fill('Pump 2 was offline.');
    await next(page).click();

    await heading(page, 'Check the return');
    const summary = page.locator('main');
    await expect(summary).toContainText('Tendai Moyo');
    await expect(summary).toContainText('tendai@example.com');
    await expect(summary).toContainText(
      'Complete the return as at the end of each month and send it to ZERA by the 3rd (section 43 of the Petroleum Act and the licence conditions).',
    );
    // Fuel sold is missing for the whole month because one day has no approved report.
    await expect(summary.getByText('Fuel sold: Petrol (litres)').locator('..')).toContainText('m');

    // Change one answer and come straight back to the check screen.
    await page
      .getByText('Licence number', { exact: true })
      .locator('xpath=../..')
      .getByRole('button', { name: 'Change' })
      .click();
    await heading(page, 'What is the licence number?');
    await page.getByLabel('Licence number').fill('L-78');
    await next(page).click();
    await heading(page, 'Check the return');
    await expect(summary).toContainText('L-78');

    await page.getByRole('button', { name: 'Save this return' }).click();
    await expect(page.getByText(/Saved as version 1/)).toBeVisible();
    expect(seen.saves).toHaveLength(1);
    expect(seen.saves[0]).toMatchObject({
      tenantId,
      stationId,
      month: '2026-10',
      ethanolPercent: 10,
      notes: 'Pump 2 was offline.',
      details: {
        licenceHolder: 'Main Oils (Pvt) Ltd',
        licenceNumber: 'L-78',
        ownership: 'COCO',
        province: 'Harare',
        representativeName: 'Tendai Moyo',
        representativePhone: '+263 77 123 4567',
        representativeEmail: 'tendai@example.com',
      },
    });
  });

  test('a station with saved licence details goes straight to the figures', async ({ page }) => {
    await mock(page, view({ details: fullDetails }));
    await startOctober(page);
    await heading(page, 'Anything to add in the notes?');
    await next(page).click();
    await heading(page, 'Check the return');
    // No petrol moved, so the ethanol percentage is written as 0, never left blank.
    await expect(
      page.getByText('Ethanol blending ratio (%)', { exact: true }).locator('..'),
    ).toContainText('0');
  });

  test('will not finish while a product has no fuel type, and says which one', async ({ page }) => {
    await mock(
      page,
      view({
        details: fullDetails,
        blockers: [{ productId: 'p1', productName: 'Mystery Fuel' }],
      }),
    );
    await startOctober(page);
    await heading(page, 'Something needs your attention');
    await expect(page.getByText(/Mystery Fuel/)).toBeVisible();
    // The link goes to this station's setup on the Settings page, where the fuel type is set.
    await expect(page.getByRole('link', { name: 'Fuels' })).toHaveAttribute(
      'href',
      `/settings?tab=stations&setup=${stationId}&tenantId=${tenantId}`,
    );
    await next(page).click();
    await expect(
      page.getByText('Set the fuel type for the products listed above first.'),
    ).toBeVisible();
    await heading(page, 'Something needs your attention');
  });

  test('downloads a saved return, confirming identity once when asked', async ({ page }) => {
    const seen = await mock(page, view({ details: fullDetails }));
    await startOctober(page);
    await next(page).click(); // notes, then the check screen
    await page.getByRole('button', { name: 'Save this return' }).click();
    await expect(page.getByText(/Saved as version 1/)).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download CSV, 2026-10 version 1/ }).click();
    expect((await download).suggestedFilename()).toBe('zera-return-2026-10-v1.csv');
    expect(seen.stepUps).toBe(1);
    expect(seen.downloads).toBe(2);
  });

  test('has no accessibility violations on the check screen at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mock(page, view({ details: fullDetails }));
    await startOctober(page);
    await heading(page, 'Anything to add in the notes?');
    await next(page).click();
    await heading(page, 'Check the return');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
