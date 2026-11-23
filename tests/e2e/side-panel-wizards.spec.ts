import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The guides that replaced the side panels (#252), each hosted alone on a development page with no
 * sign-in. They check the question order, that a wrong or empty answer stays on its own screen with
 * a plain message, that Change returns from the check screen, and exactly what would be saved.
 * What the server does with it is covered by the command and integration tests.
 */

async function open(page: Page, which: string) {
  await page.goto(`/dev-preview/panel-wizards?w=${which}`);
}

const next = (scope: Page | Locator) => scope.getByRole('button', { name: 'Continue' });
const saved = async (page: Page) =>
  JSON.parse((await page.getByTestId('saved').textContent()) || 'null');

test.describe('Guides that replaced side panels', () => {
  test('bank balance: station, amount, date, check, with each answer checked on its own', async ({
    page,
  }) => {
    await open(page, 'bank-balance');
    await expect(page.getByRole('heading', { name: 'Which station is this for?' })).toBeVisible();
    await next(page).click();
    await expect(page.getByText('Choose a station.')).toBeVisible();

    await page.getByLabel('Station').selectOption('s2');
    await next(page).click();
    await expect(
      page.getByRole('heading', { name: 'What balance does the statement show for Operating?' }),
    ).toBeVisible();
    await page.getByLabel('Balance on the statement (USD)').fill('abc');
    await next(page).click();
    await expect(page.getByText('Enter the balance as a number, such as 1250.50.')).toBeVisible();

    await page.getByLabel('Balance on the statement (USD)').fill('1,250.50');
    await next(page).click();
    await next(page).click();
    await expect(page.getByText('Choose the date on the bank statement.')).toBeVisible();
    await page.getByLabel('Date on the statement').fill('2026-11-20');
    await next(page).click();

    await expect(page.getByRole('heading', { name: 'Check the balance' })).toBeVisible();
    expect(await saved(page)).toBeNull();
    // Change goes back to one answer, and the check screen comes straight back.
    await page.getByRole('button', { name: 'Change' }).nth(1).click();
    await page.getByLabel('Balance on the statement (USD)').fill('900');
    await next(page).click();
    await expect(page.getByRole('heading', { name: 'Check the balance' })).toBeVisible();
    await page.getByRole('button', { name: 'Save balance' }).click();
    expect(await saved(page)).toEqual({ stationId: 's2', balance: '900', asOfDate: '2026-11-20' });
  });

  test('bank balance skips the station question when there is one station', async ({ page }) => {
    await open(page, 'bank-balance-one');
    await expect(
      page.getByRole('heading', { name: 'What balance does the statement show for Operating?' }),
    ).toBeVisible();
    await page.getByLabel('Balance on the statement (USD)').fill('10');
    await next(page).click();
    await page.getByLabel('Date on the statement').fill('2026-11-01');
    await next(page).click();
    await page.getByRole('button', { name: 'Save balance' }).click();
    expect(await saved(page)).toEqual({ stationId: 's1', balance: '10', asOfDate: '2026-11-01' });
  });

  test('Back on the first screen leaves the guide', async ({ page }) => {
    await open(page, 'bank-balance-one');
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await saved(page)).toBe('cancelled');
  });

  test('staff fuel benefit: who, the usual or own limit, check', async ({ page }) => {
    await open(page, 'staff-benefit');
    await next(page).click();
    await expect(page.getByText('Choose a staff member.')).toBeVisible();
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: /Rudo Chikwanha/ }).click();
    await next(page).click();

    await expect(
      page.getByRole('heading', { name: 'How much fuel can Rudo Chikwanha take each month?' }),
    ).toBeVisible();
    // Neither choice made yet.
    await next(page).click();
    await expect(page.getByText('Choose the usual limit or set your own.')).toBeVisible();

    await page.getByRole('radio', { name: /A different amount/ }).check();
    await page.locator('#staff-limit').fill('lots');
    await next(page).click();
    await expect(
      page.getByText('Enter the monthly limit in US dollars', { exact: false }),
    ).toBeVisible();
    // Picking the usual amount moves on by itself, so there is nothing to click.
    await page.getByRole('radio', { name: /The usual amount/ }).check();

    await expect(page.getByRole('heading', { name: 'Check the benefit' })).toBeVisible();
    await page.getByRole('button', { name: 'Add staff member' }).click();
    expect(await saved(page)).toMatchObject({ membershipId: 'm2' });
    expect((await saved(page)).limit).toMatch(/^60(\.0+)?$/);
  });

  test('credit limit: limit, approver, reason, check', async ({ page }) => {
    await open(page, 'credit-limit');
    await next(page).click();
    await expect(page.getByText('Enter the new limit, for example 2500.00.')).toBeVisible();
    await page.getByLabel('New credit limit (USD)').fill('2500');
    await next(page).click();

    await expect(page.getByRole('heading', { name: 'Who approved this change?' })).toBeVisible();
    await next(page).click();
    await expect(page.getByText('Choose who approved this change.')).toBeVisible();
    await page.getByLabel('Approved by').selectOption('m1');
    await next(page).click();

    await next(page).click();
    await expect(page.getByText('Say why the limit is being changed.')).toBeVisible();
    await page.getByLabel('Reason').fill('  Paid the old balance  ');
    await next(page).click();

    await expect(page.getByRole('heading', { name: 'Check the new limit' })).toBeVisible();
    await page.getByRole('button', { name: 'Change limit' }).click();
    expect(await saved(page)).toMatchObject({
      approverId: 'm1',
      reason: 'Paid the old balance',
    });
    expect(Number((await saved(page)).limit)).toBe(2500);
  });

  test('transaction details: every detail can be skipped, but not all of them', async ({
    page,
  }) => {
    await open(page, 'entry-details');
    // One station, so it is not asked about.
    await expect(
      page.getByRole('heading', { name: 'What was the vehicle registration?' }),
    ).toBeVisible();
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole('button', { name: 'Skip' }).click();
    }
    await expect(page.getByRole('heading', { name: 'Check the details' })).toBeVisible();
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(
      page.getByText('Fill in at least one of the details.', { exact: false }),
    ).toBeVisible();
    expect(await saved(page)).toBeNull();

    await page.getByRole('button', { name: 'Change' }).first().click();
    await page.getByLabel('Vehicle registration').fill('AEF 1234');
    await next(page).click();
    await page.getByRole('button', { name: 'Save details' }).click();
    expect(await saved(page)).toMatchObject({ stationId: 's1', vehicle: 'AEF 1234' });
  });

  test('expense categories: list, add a kind, refuse a duplicate, check', async ({ page }) => {
    await open(page, 'categories');
    await expect(page.getByRole('heading', { name: 'Kinds of expense' })).toBeVisible();
    await expect(page.getByText('Repairs')).toBeVisible();
    await page.getByRole('button', { name: 'Add a kind of expense' }).click();

    await next(page).click();
    await expect(
      page.getByText('Type a name for the kind of expense', { exact: false }),
    ).toBeVisible();
    await page.getByLabel('Name').fill('repairs');
    await next(page).click();
    await expect(page.getByText('already', { exact: false })).toBeVisible();
    await page.getByLabel('Name').fill('Staff meals');
    await next(page).click();

    await expect(page.getByRole('heading', { name: 'Is it a fixed monthly cost?' })).toBeVisible();
    await next(page).click();
    await expect(page.getByText('Choose Yes or No.')).toBeVisible();
    await page.getByRole('radio', { name: 'No' }).check();
    await next(page).click();
    await expect(page.getByRole('heading', { name: 'Check the new kind' })).toBeVisible();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    expect(await saved(page)).toEqual({ name: 'Staff meals', fixed: false });
  });

  test('approval limits: one limit per screen, usual answers first, own amount checked', async ({
    page,
  }) => {
    await open(page, 'limits');
    await expect(
      page.getByRole('heading', { name: 'When should the approver confirm their identity again?' }),
    ).toBeVisible();
    await next(page).click(); // "Always" is the current answer.

    await expect(
      page.getByRole('heading', { name: 'When must a second person approve?' }),
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Another amount' }).check();
    await page.getByLabel('Needs a second person to approve above').fill('abc');
    await next(page).click();
    await expect(page.getByText('Enter an amount like 1000.')).toBeVisible();
    await page.getByLabel('Needs a second person to approve above').fill('2500');
    await next(page).click();

    await next(page).click(); // supervisor keeps its current answer
    await expect(page.getByRole('heading', { name: 'Check the approval limits' })).toBeVisible();
    await page.getByRole('button', { name: 'Save limits' }).click();
    expect(await saved(page)).toEqual({ stepUp: '', second: '2500', supervisor: '100' });
  });

  test('purchase order settings (company): one rule per screen, a reason, then save', async ({
    page,
  }) => {
    await open(page, 'policy-company');
    await expect(
      page.getByRole('heading', {
        name: 'How much can the invoice quantity differ from what was received?',
      }),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Same as the company' })).toHaveCount(0);
    for (let i = 0; i < 12; i += 1) {
      if (
        await page
          .getByRole('heading', { name: 'Why are you changing these settings?' })
          .isVisible()
      )
        break;
      await next(page).click();
    }
    await expect(
      page.getByRole('heading', { name: 'Why are you changing these settings?' }),
    ).toBeVisible();
    await next(page).click();
    await expect(
      page.getByRole('heading', { name: 'Why are you changing these settings?' }),
    ).toBeVisible();
    await page.getByLabel('Reason').fill('Tighter control');
    await next(page).click();
    await expect(page.getByRole('heading', { name: 'Check the settings' })).toBeVisible();
    expect(await saved(page)).toBeNull();
    await page.getByRole('button', { name: 'Save settings' }).click();
    expect(await saved(page)).toMatchObject({ reason: 'Tighter control' });
  });

  test('purchase order settings (supplier) can follow the company, and view-only cannot save', async ({
    page,
  }) => {
    await open(page, 'policy-supplier');
    await expect(page.getByRole('radio', { name: 'Same as the company' })).toBeVisible();
    await open(page, 'policy-view');
    await expect(page.getByText('You can see these settings but not change them.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
  });

  test('edit company: the name is checked, then a check screen, then it saves', async ({
    page,
  }) => {
    await open(page, 'edit-company');
    await expect(page.getByRole('heading', { name: 'What is the company called?' })).toBeVisible();
    await page.getByLabel('Company name').fill('   ');
    await next(page).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    expect(await saved(page)).toBeNull();
    await page.getByLabel('Company name').fill('  Main Oils (Pvt) Ltd ');
    await next(page).click();
    await expect(page.getByRole('heading', { name: 'Check the company' })).toBeVisible();
    await page.getByRole('button', { name: 'Save company' }).click();
    expect(await saved(page)).toBe('Main Oils (Pvt) Ltd');
  });

  test('edit station: name, time zone, check, with Change going back', async ({ page }) => {
    await open(page, 'edit-station');
    await expect(page.getByRole('heading', { name: 'What is the station called?' })).toBeVisible();
    await page.getByLabel('Station name').fill('');
    await next(page).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await page.getByLabel('Station name').fill('Main Road');
    await next(page).click();
    await expect(
      page.getByRole('heading', { name: 'Which time zone is the station in?' }),
    ).toBeVisible();
    await next(page).click();
    await expect(page.getByRole('heading', { name: 'Check the station' })).toBeVisible();
    await page.getByRole('button', { name: 'Change' }).first().click();
    await page.getByLabel('Station name').fill('Main Road North');
    await next(page).click();
    await expect(page.getByRole('heading', { name: 'Check the station' })).toBeVisible();
    await page.getByRole('button', { name: 'Save station' }).click();
    expect(await saved(page)).toEqual({ name: 'Main Road North', zone: 'Africa/Harare' });
  });

  test('staff access: a station role asks where, an all-stations role does not', async ({
    page,
  }) => {
    await open(page, 'staff-access');
    await expect(page.getByRole('heading', { name: 'What will Tendai do?' })).toBeVisible();
    await next(page).click();
    await expect(page.getByRole('heading', { name: 'Where will they work?' })).toBeVisible();
    // Untick the only chosen station: a station role needs at least one.
    await page.getByRole('checkbox', { name: /Main/ }).uncheck();
    await next(page).click();
    await expect(page.getByRole('alert').filter({ hasText: /station/i })).toBeVisible();
    await page.getByRole('checkbox', { name: /North/ }).check();
    await next(page).click();
    await expect(page.getByRole('heading', { name: 'Check the new access' })).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    expect(await saved(page)).toMatchObject({
      role: 'ATTENDANT',
      scopeType: 'STATION',
      stationIds: ['s2'],
    });

    await open(page, 'staff-access');
    await page.getByLabel('Role').selectOption('ADMINISTRATOR');
    await next(page).click();
    await expect(page.getByRole('heading', { name: 'Check the new access' })).toBeVisible();
    await expect(page.getByText('Every station')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    expect(await saved(page)).toMatchObject({
      role: 'ADMINISTRATOR',
      scopeType: 'TENANT',
      stationIds: [],
    });
  });

  for (const width of [320, 390, 1280]) {
    test(`first screens fit and pass accessibility checks at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const which of [
        'bank-balance',
        'limits',
        'policy-company',
        'staff-access',
        'categories',
      ]) {
        await open(page, which);
        await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${which} at ${width}px`).toBeLessThanOrEqual(0);
        const results = await new AxeBuilder({ page }).analyze();
        expect(
          results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
          which,
        ).toEqual([]);
      }
    });
  }
});
