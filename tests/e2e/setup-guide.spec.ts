import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * The station page and its setup wizards, driven against sample API answers so no Clerk user or
 * database is needed. It checks the plain-language flow a non-technical owner follows, one question
 * per screen, not server rules (those are covered by the setup integration tests).
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
    await route.fulfill({ json: { status: 'ready', tenantId, data: configuration(state) } });
  });
  await page.route('**/api/setup/commands', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    commands.push(body);
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/forecourt/commands', async (route) => {
    commands.push(route.request().postDataJSON() as Record<string, unknown>);
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

const next = (page: Page) => page.getByRole('button', { name: 'Continue' });

test.describe('Station page and setup wizards', () => {
  test('has no editing screen: a new station offers the guide and a fuel wizard', async ({
    page,
  }) => {
    const { commands } = await mockApi(page);
    await page.goto('/dev-preview/setup-guide');

    await expect(page.getByRole('heading', { name: 'Fuels' })).toBeVisible();
    await expect(page.getByText('No fuel has been added to this station yet.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The whole station' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Change setup|Done changing/ })).toHaveCount(0);

    // Adding a fuel asks one thing per screen: the type, the name, then how it is measured.
    await page.getByRole('button', { name: 'Add a fuel' }).click();
    await next(page).click();
    await expect(page.getByText('Choose the type of fuel.')).toBeVisible();
    expect(commands).toHaveLength(0);

    // Gas is measured in kilograms by default; every other type in litres.
    // Picking a type carries straight on to the next screen, so there is no Continue to press.
    await page.getByText('Gas', { exact: true }).click();
    await page.locator('#name').fill('Unleaded 95');
    await next(page).click();
    await expect(page.locator('#fuel-unit-KILOGRAMS')).toBeChecked();
    await page.getByText('Litres', { exact: true }).click();

    // The answers wait. The identity check and the save happen once, at the review step.
    await page.getByRole('button', { name: 'Add the fuel' }).click();
    await page.getByRole('button', { name: /^No/ }).click();
    await expect(page.getByText('1 change is waiting.')).toBeVisible();
    await expect(page.getByText('Confirm it is you')).toHaveCount(0);
    expect(commands).toHaveLength(0);
    await openReviewAndSave(page);
    expect(commands).toHaveLength(0);
  });

  test('shows each fuel as its own card and opens its parts on their own page', async ({
    page,
  }) => {
    await mockApi(page, [{ id: 'p1', code: 'UNLEADED95', name: 'Unleaded 95', status: 'ACTIVE' }]);
    await page.goto('/dev-preview/setup-guide');
    await expect(page.getByRole('listitem', { name: /Open Unleaded 95/ })).toBeVisible();
    await page.getByRole('listitem', { name: /Open Unleaded 95/ }).click();
    await expect(page.getByText('Still to do: a price, a tank, a nozzle.')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, change it' }).click();
    await page.getByText('The price', { exact: true }).click();
    await next(page).click();
    await expect(
      page.getByRole('heading', { name: /new price per litre of Unleaded 95/i }),
    ).toBeVisible();
  });

  test('lets the owner choose the supervisor in charge', async ({ page }) => {
    const { commands } = await mockApi(page);
    await page.goto('/dev-preview/setup-guide');
    await page.getByRole('button', { name: 'Change who is in charge' }).click();
    await next(page).click();
    await expect(page.getByText('Choose who is in charge of this station.')).toBeVisible();
    await page.getByLabel('Tendai Moyo').check();
    await next(page).click();
    await page.getByRole('button', { name: 'Save the choice' }).click();
    await expect(page.getByText('1 change is waiting.')).toBeVisible();
    await expect(page.getByText('Confirm it is you')).toHaveCount(0);
    expect(commands).toHaveLength(0);
    await openReviewAndSave(page);
    expect(commands).toHaveLength(0);
  });

  test('adds a shift one question at a time', async ({ page }) => {
    await mockApi(page);
    await page.goto('/dev-preview/setup-guide');
    await page.getByRole('button', { name: 'Change shifts' }).click();
    await page.getByText('Add a shift', { exact: true }).click();
    await next(page).click();
    await next(page).click();
    await expect(page.getByText('Give the shift a name, for example Day shift.')).toBeVisible();
    await page.locator('#name').fill('Night shift');
    await next(page).click();
    await next(page).click();
    await expect(page.getByText('Choose the start time.')).toBeVisible();
    await page.locator('#start').fill('18:00');
    await page.locator('#end').fill('06:00');
    await next(page).click();
    await expect(page.getByText('18:00 to 06:00 (ends the next day)')).toBeVisible();
    await page.getByRole('button', { name: 'Add the shift' }).click();
    await page.getByRole('button', { name: /^No/ }).click();
    await expect(page.getByText('1 change is waiting.')).toBeVisible();
  });

  for (const width of [320, 390, 768, 1280]) {
    test(`fits the screen and passes accessibility checks at ${width}px`, async ({ page }) => {
      await mockApi(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dev-preview/setup-guide');
      await expect(page.getByRole('heading', { name: 'The whole station' })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
