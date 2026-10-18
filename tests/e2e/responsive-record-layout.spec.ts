import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
test.beforeAll(() => {
  execFileSync(
    'pnpm',
    ['exec', 'vitest', 'run', 'src/modules/settings/ui/settings-controls.test.ts'],
    { env: { ...process.env, SETTINGS_MENU_FIXTURE: '1' }, stdio: 'pipe' },
  );
});

// Synthetic populated markup uses the production selectors and styles. No account/data writes.
const settingsCss = readFileSync('src/modules/settings/ui/settings-workspace.module.css', 'utf8');
for (const width of [390, 824, 1024, 1440]) {
  test(`Settings and record lists adapt to available width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(
      '<div class="app-shell"><aside class="shell-sidebar"></aside><div class="shell-main"><main id="main-content"></main></div></div>',
    );
    for (const file of [
      'tokens',
      'base',
      'components',
      'shell',
      'shell-phase1',
      'reports',
      'approved-ui',
    ]) {
      await page.addStyleTag({
        content: readFileSync(`src/design-system/styles/${file}.css`, 'utf8'),
      });
    }
    await page.addStyleTag({ content: readFileSync('src/app/globals.css', 'utf8') });
    await page.addStyleTag({ content: settingsCss });
    await page.locator('#main-content').evaluate((main) => {
      const cells = ['Email', 'Role', 'Scope', 'Status'];
      main.innerHTML = `<section class="page settings-page"><div class="layout"><label class="sectionMenu"><span>Section</span><select aria-label="Settings section"><option>Organisation</option><option>Companies</option><option>Stations</option><option>Readiness</option><option>Payments</option><option selected>Staff</option><option>Account</option></select></label><nav class="subnav">${['Organisation', 'Companies', 'Stations', 'Readiness', 'Payments', 'Staff', 'Account'].map((s) => `<button class="subnavItem">${s}</button>`).join('')}</nav><section class="content"><h2>Staff</h2><div class="staffTable"><div class="staffHead"><span>Name</span><span>Email</span><span>Role</span><span>Scope</span><span>Status</span></div><ul class="staffRows"><li class="staffTableRow"><div class="staffName">Admin Admin</div>${cells.map((label, i) => `<div class="staffCell" data-label="${label}">${['administrator@example.com', 'Owner', 'All organisation stations', 'Active'][i]}</div>`).join('')}</li></ul></div></section></div></section><section style="max-width:600px"><div class="list-table supplier-table"><div class="list-head">Supplier balances</div><ul class="list-rows"><li class="list-row"><div class="list-name">Fuel supplier with a long name</div>${['Entity', 'Balance', 'Overdue', 'Credit', 'Actions'].map((label) => `<div class="list-cell" data-label="${label}">12345.0000 USD</div>`).join('')}</li></ul></div><div class="list-table ledger-table"><div class="list-head">Movements</div><ul class="list-rows"><li class="list-row ledger-row">${['Date', 'Movement', 'Posted', 'Amount', 'Balance'].map((label) => `<div class="list-cell" data-label="${label}">Supplier statement information</div>`).join('')}</li></ul></div><div class="list-table"><div class="list-head">Customers</div><ul class="list-rows"><li class="list-row"><div class="list-name">Customer account</div><div class="list-cell" data-label="Account">Long customer account reference</div><div class="list-cell" data-label="Status">Active</div><div class="list-cell" data-label="Details">Account information</div></li></ul></div></section>`;
    });
    await page.locator('.sectionMenu').evaluate(
      (element, html) => {
        element.outerHTML = html;
      },
      readFileSync('/private/tmp/shanda-settings-menu.html', 'utf8'),
    );
    if (width <= 768) {
      await expect(page.locator('.sectionTrigger')).toBeVisible();
      await page.locator('.sectionTrigger').click();
      await expect(page.getByRole('navigation', { name: 'Choose Settings section' })).toBeVisible();
      await expect(page.locator('.sectionOptions button[aria-current=page]')).toHaveText('Staff');
      await page.locator('.sectionTrigger').click();
      await expect(page.getByRole('navigation', { name: 'Choose Settings section' })).toBeHidden();
      await expect(page.locator('.subnav')).toBeHidden();
      expect((await page.locator('.sectionMenu').boundingBox())!.height).toBeLessThan(60);
    } else {
      await expect(page.locator('.sectionMenu')).toBeHidden();
      await expect(page.locator('.subnav')).toBeVisible();
      expect(
        await page.locator('.subnav').evaluate((el) => getComputedStyle(el).flexDirection),
      ).toBe('column');
    }
    const staff = page.locator('.staffTableRow');
    const contentWidth = await page
      .locator('.content')
      .evaluate(
        (el) =>
          el.clientWidth -
          parseFloat(getComputedStyle(el).paddingLeft) -
          parseFloat(getComputedStyle(el).paddingRight),
      );
    if (contentWidth <= 704) {
      await expect(page.locator('.staffHead')).toBeHidden();
      expect(
        (await staff.evaluate((el) => getComputedStyle(el).gridTemplateColumns)).split(' '),
      ).toHaveLength(1);
    } else {
      await expect(page.locator('.staffHead')).toBeVisible();
    }
    await expect(page.locator('.list-head').first()).toBeHidden();
    for (const row of await page.locator('.list-row').all()) {
      expect(
        (await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns)).split(' '),
      ).toHaveLength(1);
      expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({
      path: `/private/tmp/shanda-responsive-records-${width}.png`,
      fullPage: true,
    });
  });
}
