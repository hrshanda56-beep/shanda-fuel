import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The guided station setup, driven against sample API answers so no Clerk user or database is
 * needed. It checks the plain-language flow a non-technical owner follows, not server rules (those
 * are covered by the setup integration tests).
 */

const tenantId = 'e2e80000-0000-4000-8000-000000000001';
const stationId = 'e2e80000-0000-4000-8000-000000000021';

type Product = { id: string; code: string; name: string; status: string };

function configuration(state: { products: Product[]; supervisor: string | null }) {
  return {
    tenantId,
    stationId,
    stationStatus: 'ONBOARDING',
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
    products: state.products,
    tanks: [],
    pumps: [],
    nozzles: [],
    shiftTemplates: [],
    prices: [],
    suppliers: [],
    supervisors: [{ membershipId: 'e2e80000-0000-4000-8000-000000000041', name: 'Tendai Moyo' }],
    responsibleSupervisorMembershipId: state.supervisor,
    blockers: [],
  };
}

async function mockApi(page: Page, products: Product[] = []) {
  const state = { products, supervisor: null as string | null };
  const commands: Array<Record<string, unknown>> = [];
  await page.route('**/api/setup/overview**', async (route) => {
    await route.fulfill({
      json: {
        status: 'ready',
        tenantId,
        canViewReadiness: true,
        canViewPayments: false,
        canManagePayments: false,
        stations: [],
        stationOptions: [{ id: stationId, code: 'MAIN', name: 'Main Station', legalEntityId: 'x' }],
        providers: [],
        providerAccounts: [],
        bankAccounts: [],
        data: configuration(state),
      },
    });
  });
  await page.route('**/api/setup/commands', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    commands.push(body);
    if (body.commandType === 'CreateProduct') {
      state.products.push({
        id: `p${state.products.length + 1}`,
        code: String(body.code),
        name: String(body.name),
        status: 'ACTIVE',
      });
    }
    if (body.commandType === 'SetResponsibleSupervisor')
      state.supervisor = String(body.membershipId);
    await route.fulfill({ json: { ok: true } });
  });
  return { commands, state };
}

/** The one place the identity check appears: the review step, after pressing Save. */
async function openReviewAndSave(page: Page) {
  await page.getByRole('button', { name: 'Review and save' }).click();
  await page
    .getByRole('dialog', { name: 'Review your changes' })
    .getByRole('button', { name: /^Save (this|\d+) change/ })
    .click();
  await expect(page.getByText('Confirm it is you').first()).toBeVisible();
}

test.describe('Guided station setup', () => {
  test('walks an owner from an empty station to adding the first fuel in plain language', async ({
    page,
  }) => {
    const { commands } = await mockApi(page);
    await page.goto('/dev-preview/setup-guide');

    await expect(page.getByRole('heading', { name: 'Fuel Types' })).toBeVisible();
    await expect(page.getByText('No fuel types yet. Add the first one to begin.')).toBeVisible();

    // Adding a fuel asks for the fuel type and its unit, in a small dialog.
    await page.getByRole('button', { name: 'Add a fuel type' }).click();
    const form = page.getByRole('form', { name: 'Add a fuel type' });
    await form.getByRole('button', { name: 'Add fuel type' }).click();
    await expect(page.getByText('Choose the type of fuel.')).toBeVisible();
    expect(commands).toHaveLength(0);

    // Gas is measured in kilograms by default; every other type in litres.
    await form.getByLabel('Type of fuel').selectOption('GAS');
    await expect(form.getByLabel('Measured in')).toHaveValue('KILOGRAMS');

    // Entries wait on the screen. The identity check and the save happen once, at the review step.
    await form.getByLabel('Type of fuel').selectOption('OTHER');
    await expect(form.getByLabel('Measured in')).toHaveValue('LITRES');
    await form.getByLabel('Fuel name').fill('Unleaded 95');
    await form.getByRole('button', { name: 'Add fuel type' }).click();
    await expect(page.getByText('1 change is waiting.')).toBeVisible();
    await expect(page.getByText('Confirm it is you')).toHaveCount(0);
    expect(commands).toHaveLength(0);
    await openReviewAndSave(page);
    expect(commands).toHaveLength(0);
  });

  test('shows each fuel as its own card, with the parts still to do', async ({ page }) => {
    await mockApi(page, [{ id: 'p1', code: 'UNLEADED95', name: 'Unleaded 95', status: 'ACTIVE' }]);
    await page.goto('/dev-preview/setup-guide');
    const fuels = page.getByRole('list', { name: 'Fuel types' });
    await expect(fuels.getByText('Needs a price, a tank, a nozzle.')).toBeVisible();
    // Each part opens on its own page, and Done returns to the card.
    await page.getByRole('button', { name: 'Unleaded 95: Price' }).click();
    await expect(page.getByRole('form', { name: 'Set a selling price' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('form', { name: 'Set a selling price' })).toBeHidden();
    await expect(fuels).toBeVisible();
  });

  test('lets the owner choose the supervisor in charge', async ({ page }) => {
    const { commands } = await mockApi(page);
    await page.goto('/dev-preview/setup-guide');
    await page.getByRole('button', { name: 'Change who is in charge' }).click();
    // Save sits in the page footer, outside the form, and submits it.
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await save.click();
    await expect(page.getByText('Choose who is in charge of this station.')).toBeVisible();
    await page
      .getByRole('form', { name: 'Choose the supervisor in charge' })
      .getByLabel('Tendai Moyo')
      .check();
    await save.click();
    await expect(page.getByText('1 change is waiting.')).toBeVisible();
    await expect(page.getByText('Confirm it is you')).toHaveCount(0);
    expect(commands).toHaveLength(0);
    await openReviewAndSave(page);
    expect(commands).toHaveLength(0);
  });

  for (const width of [320, 390, 768, 1280]) {
    test(`fits the screen and passes accessibility checks at ${width}px`, async ({ page }) => {
      await mockApi(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dev-preview/setup-guide');
      await expect(page.getByRole('heading', { name: 'Fuel Types' })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
