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

async function mockApi(page: Page) {
  const state = { products: [] as Product[], supervisor: null as string | null };
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

test.describe('Guided station setup', () => {
  test('walks an owner from an empty station through the first steps in plain language', async ({
    page,
  }) => {
    const { commands } = await mockApi(page);
    await page.goto('/dev-preview/setup-guide');

    await expect(page.getByText('0 of 6 steps done for Main Station')).toBeVisible();
    // Steps that need fuel types are closed with a plain reason, not an error.
    await expect(page.getByRole('button', { name: /^Selling prices/ })).toBeDisabled();
    await expect(page.getByText('Add at least one fuel type first.').first()).toBeVisible();

    // The first step is open and asks only for a name.
    const form = page.getByRole('form', { name: 'Add a fuel type' });
    await form.getByRole('button', { name: 'Add fuel type' }).click();
    await expect(page.getByText('Enter the name of the fuel, for example Diesel.')).toBeVisible();
    expect(commands).toHaveLength(0);

    await form.getByLabel('Fuel name').fill('Unleaded 95');
    await form.getByRole('button', { name: 'Add fuel type' }).click();
    await expect(page.getByText('Unleaded 95 was added.')).toBeVisible();
    // The person never sees or types a code; one is made from the name.
    expect(commands[0]).toMatchObject({
      commandType: 'CreateProduct',
      name: 'Unleaded 95',
      code: 'UNLEADED95',
    });
    await expect(page.getByText('1 of 6 steps done for Main Station')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Selling prices/ })).toBeEnabled();
    // Moving on is the person's choice: the confirmation stays until they press Next.
    await page.getByRole('button', { name: 'Next: Selling prices' }).click();
    await expect(page.getByRole('form', { name: 'Set a selling price' })).toBeVisible();
  });

  test('lets the owner choose the supervisor in charge', async ({ page }) => {
    const { commands } = await mockApi(page);
    await page.goto('/dev-preview/setup-guide');
    await page.getByRole('button', { name: /Supervisor in charge/ }).click();
    const form = page.getByRole('form', { name: 'Choose the supervisor in charge' });
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Choose who is in charge of this station.')).toBeVisible();
    await form.getByLabel('Tendai Moyo').check();
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Tendai Moyo is now in charge of this station.')).toBeVisible();
    expect(commands.at(-1)).toMatchObject({ commandType: 'SetResponsibleSupervisor' });
  });

  for (const width of [320, 390, 768, 1280]) {
    test(`fits the screen and passes accessibility checks at ${width}px`, async ({ page }) => {
      await mockApi(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dev-preview/setup-guide');
      await expect(page.getByText('0 of 6 steps done for Main Station')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
