import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The opening-balances wizard on the station page, driven against sample API answers so no Clerk
 * user or database is needed. It checks the one-question-at-a-time flow and that the answers become
 * the same import file the spreadsheet import reads; the server rules have their own tests.
 */

const tenantId = 'e2e80000-0000-4000-8000-000000000001';
const stationId = 'e2e80000-0000-4000-8000-000000000021';

const overview = {
  status: 'ready',
  tenantId,
  data: {
    tenantId,
    stationId,
    stationStatus: 'ACTIVE',
    capabilities: {
      products: true,
      tanks: true,
      forecourt: true,
      shiftTemplates: true,
      priceRequest: true,
      priceApprove: false,
      priceActivate: false,
      suppliers: true,
    },
    products: [],
    tanks: [],
    pumps: [],
    nozzles: [],
    shiftTemplates: [],
    prices: [],
    suppliers: [],
    supervisors: [],
    responsibleSupervisorMembershipId: null,
    blockers: [],
  },
};

const options = {
  station: {
    id: stationId,
    code: 'MAIN',
    name: 'Main Station',
    companyReference: 'Main Oils (Pvt) Ltd',
    companyName: 'Main Oils (Pvt) Ltd',
  },
  tanks: [{ code: 'T1', fuel: 'Diesel', capacityLitres: '50000.000', hasOpening: false }],
  cashLocations: [{ code: 'SAFE', name: 'Station safe', hasOpening: false }],
  bankAccounts: [{ name: 'Operating account', bankName: 'CBZ Bank', hasOpening: false }],
  customers: [
    {
      accountId: '11111111-1111-4111-8111-111111111111',
      name: 'Moyo Transport',
      hasOpening: false,
    },
  ],
  suppliers: [{ code: 'ZUVA', name: 'Zuva Petroleum' }],
};

async function mockApi(page: Page, duplicate?: { id: string; state: string }) {
  const seen = { csv: '', commands: [] as string[] };
  await page.route('**/api/setup/overview**', (route) => route.fulfill({ json: overview }));
  await page.route('**/api/opening-balances**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { options } });
    if ((request.headers()['content-type'] ?? '').startsWith('text/csv')) {
      seen.csv = request.postData() ?? '';
      return route.fulfill({
        json: {
          valid: !duplicate,
          duplicateBatch: duplicate ?? null,
          parserIssues: [],
          resolutionIssues: [],
          rowCount: 5,
        },
      });
    }
    const body = request.postDataJSON() as { commandType: string };
    seen.commands.push(body.commandType);
    const state = body.commandType.startsWith('Create')
      ? { batchId: 'b1', state: 'DRAFT', version: 0 }
      : body.commandType.startsWith('Approve')
        ? { batchId: 'b1', state: 'APPROVED', version: 1 }
        : { batchId: 'b1', state: 'LOCKED', version: 2 };
    return route.fulfill({ status: 201, json: state });
  });
  return seen;
}

const next = (page: Page) => page.getByRole('button', { name: 'Continue' });
const startWizard = async (page: Page) => {
  await page.goto('/dev-preview/setup-guide');
  await page.getByRole('button', { name: 'Add opening balances' }).click();
};

test.describe('Opening balances wizard', () => {
  test('asks one question at a time and saves the same import file', async ({ page }) => {
    const seen = await mockApi(page);
    await startWizard(page);

    // The question comes first, and No leaves without asking anything else.
    await expect(
      page.getByRole('heading', { name: /add the opening balances now/i }),
    ).toBeVisible();
    await next(page).click();
    await expect(page.getByText('Choose Yes or No.')).toBeVisible();
    await page.getByText('Yes', { exact: true }).click();
    await next(page).click();

    await next(page).click();
    await expect(page.getByText('Choose the day these figures are for.')).toBeVisible();
    await page.locator('#asOf').fill('2026-11-20');
    await next(page).click();

    // Tank: needs litres that fit the tank.
    await expect(page.getByRole('heading', { name: /fuel is in Tank 1/i })).toBeVisible();
    await next(page).click();
    await expect(page.getByText(/Enter how many litres/)).toBeVisible();
    await page.locator('#litres').fill('90000');
    await next(page).click();
    await expect(page.getByText(/only holds 50,000 litres/)).toBeVisible();
    await page.locator('#litres').fill('12500.5');
    await next(page).click();

    // Cash: None leaves it out.
    await expect(page.getByRole('heading', { name: /cash is in Station safe/i })).toBeVisible();
    await page.getByRole('button', { name: 'None' }).click();

    // Bank: a balance of 0 is fine.
    await expect(
      page.getByRole('heading', { name: /balance of Operating account/i }),
    ).toBeVisible();
    await page.locator('#amount').fill('0');
    await next(page).click();

    // A customer, then a supplier invoice.
    await page.getByText('Yes', { exact: true }).click();
    await next(page).click();
    await page.getByText('Moyo Transport', { exact: true }).click();
    await next(page).click();
    await page.locator('#amount').fill('320.50');
    await next(page).click();
    await next(page).click(); // no due day
    await page.getByRole('button', { name: 'No, that is all' }).click();
    await page.getByText('Yes', { exact: true }).click();
    await next(page).click();
    await page.getByText('Zuva Petroleum', { exact: true }).click();
    await next(page).click();
    await next(page).click();
    await expect(page.getByText('Enter the invoice number or reference.')).toBeVisible();
    await page.locator('#reference').fill('INV-1');
    await next(page).click();
    await page.locator('#amount').fill('900');
    await next(page).click();
    await next(page).click(); // no due day
    await page.getByRole('button', { name: 'No, that is all' }).click();

    // Check: every figure in words, cash left out because of None.
    await expect(page.getByRole('heading', { name: /Check the 4 opening figures/i })).toBeVisible();
    await expect(page.getByText('Tank 1 (Diesel): 12,500.5 litres')).toBeVisible();
    await expect(page.getByText('Operating account (CBZ Bank): $0.00')).toBeVisible();
    await expect(page.getByText('Moyo Transport: $320.50')).toBeVisible();
    await expect(page.getByText('Zuva Petroleum, invoice INV-1: $900.00')).toBeVisible();
    await expect(page.getByText('Station safe')).toHaveCount(0);
    // The tank has fuel but no value, so the check screen says the station cannot go live yet.
    await expect(page.getByText(/Tank 1 has fuel but no value/)).toBeVisible();

    await page.getByRole('button', { name: 'Save as a draft' }).click();
    await expect(page.getByRole('heading', { name: /Saved as a draft/i })).toBeVisible();
    expect(seen.csv).toContain('TANK_STOCK');
    expect(seen.csv).toContain(',12500.5,');
    expect(seen.csv).toContain('CUSTOMER_CHARGE');
    expect(seen.csv).toContain('SUPPLIER_INVOICE');
    expect(seen.csv).not.toContain('CASH_BALANCE');
    expect(seen.commands).toEqual(['CreateOpeningBalanceBatch']);

    // Approve, then lock: locking needs the tick first.
    await page.getByRole('button', { name: 'Approve the figures' }).click();
    const lock = page.getByRole('button', { name: 'Lock and post' });
    await expect(lock).toBeDisabled();
    await page.getByLabel(/locked figures cannot be edited/i).check();
    await lock.click();
    await expect(page.getByRole('heading', { name: /locked and posted/i })).toBeVisible();
    expect(seen.commands).toEqual([
      'CreateOpeningBalanceBatch',
      'ApproveOpeningBalanceBatch',
      'LockOpeningBalanceBatch',
    ]);
  });

  test('a reload part way through keeps the answers and offers to carry on', async ({ page }) => {
    await mockApi(page);
    await startWizard(page);
    await page.getByText('Yes', { exact: true }).click();
    await next(page).click();
    await page.locator('#asOf').fill('2026-11-20');
    await next(page).click();
    await page.locator('#litres').fill('12500.5');
    await next(page).click();
    await expect(page.getByRole('heading', { name: /cash is in Station safe/i })).toBeVisible();
    // The answer is kept a moment after it changes.
    await page.waitForTimeout(700);

    await page.reload();
    await page.getByRole('button', { name: 'Add opening balances' }).click();
    await expect(page.getByText('You were part way through this.')).toBeVisible();
    await page.getByRole('button', { name: 'Continue where I was' }).click();

    // Back at the start of the figures with the tank still filled in.
    await expect(page.locator('#asOf')).toHaveValue('2026-11-20');
    await next(page).click();
    await expect(page.locator('#litres')).toHaveValue('12500.5');

    // Starting again forgets it.
    await page.reload();
    await page.getByRole('button', { name: 'Add opening balances' }).click();
    await page.getByRole('button', { name: 'Start again' }).click();
    await expect(page.getByText('You were part way through this.')).toHaveCount(0);
  });

  test('figures that were already saved as a draft carry on to approval instead of stopping', async ({
    page,
  }) => {
    const seen = await mockApi(page, { id: 'b1', state: 'DRAFT' });
    await startWizard(page);
    await page.getByText('Yes', { exact: true }).click();
    await next(page).click();
    await page.locator('#asOf').fill('2026-11-20');
    await next(page).click();
    await page.locator('#litres').fill('1000');
    await next(page).click();
    await page.getByRole('button', { name: 'None' }).click();
    await page.locator('#amount').fill('0');
    await next(page).click();
    await page.getByText('No', { exact: true }).click(); // no customers owe
    await next(page).click();
    await page.getByText('No', { exact: true }).click(); // no supplier invoices
    await next(page).click();

    await page.getByRole('button', { name: 'Save as a draft' }).click();
    // The same file is already a draft: nothing is created again, the wizard goes on to approval.
    await expect(page.getByRole('heading', { name: /Saved as a draft/i })).toBeVisible();
    expect(seen.commands).toEqual([]);
    await page.getByRole('button', { name: 'Approve the figures' }).click();
    await expect(page.getByRole('heading', { name: /Approved/i })).toBeVisible();
    expect(seen.commands).toEqual(['ApproveOpeningBalanceBatch']);
  });

  test('No on the first question leaves without saving anything', async ({ page }) => {
    const seen = await mockApi(page);
    await startWizard(page);
    await page.getByText('No', { exact: true }).click();
    await next(page).click();
    await expect(page.getByRole('heading', { name: 'The whole station' })).toBeVisible();
    expect(seen.commands).toEqual([]);
  });

  for (const width of [320, 1280]) {
    test(`fits the screen and passes accessibility checks at ${width}px`, async ({ page }) => {
      await mockApi(page);
      await page.setViewportSize({ width, height: 900 });
      await startWizard(page);
      await expect(
        page.getByRole('heading', { name: /add the opening balances now/i }),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
