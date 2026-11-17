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
    await expect(page.getByText('Choose the fuel from the list.')).toBeVisible();
    expect(commands).toHaveLength(0);

    // Every setup save asks for the identity check first; nothing is sent until it is confirmed.
    await form.getByLabel('Fuel type').selectOption('LP Gas');
    await expect(form.getByLabel('Measured in')).toHaveValue('KILOGRAMS');
    await form.getByRole('button', { name: 'Add fuel type' }).click();
    await expect(page.getByText('Confirm it is you').first()).toBeVisible();
    expect(commands).toHaveLength(0);
  });

  test('shows each fuel as its own card, opened on the part still to do', async ({ page }) => {
    await mockApi(page, [{ id: 'p1', code: 'UNLEADED95', name: 'Unleaded 95', status: 'ACTIVE' }]);
    await page.goto('/dev-preview/setup-guide');
    // The card's name starts with its status; the menu and delete buttons do not carry the summary.
    const card = page.getByRole('button', { name: /Unleaded 95.*Needs a price/ });
    await expect(card).toBeVisible();
    // The first card still to do opens on its own, on the price.
    await expect(card).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('form', { name: 'Set a selling price' })).toBeVisible();
    await card.click();
    await expect(page.getByRole('form', { name: 'Set a selling price' })).toBeHidden();
  });

  test('lets the owner choose the supervisor in charge', async ({ page }) => {
    const { commands } = await mockApi(page);
    await page.goto('/dev-preview/setup-guide');
    await page.getByRole('button', { name: /Supervisor in charge/ }).click();
    // Save sits in the card's corner, outside the form, and submits it.
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await save.click();
    await expect(page.getByText('Choose who is in charge of this station.')).toBeVisible();
    await page
      .getByRole('form', { name: 'Choose the supervisor in charge' })
      .getByLabel('Tendai Moyo')
      .check();
    await save.click();
    await expect(page.getByText('Confirm it is you').first()).toBeVisible();
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
