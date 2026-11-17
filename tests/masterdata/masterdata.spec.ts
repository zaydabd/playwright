/**
 * Master Data Management – front-end tests (FSD Annex D, sections 9.1–9.10, 9.14 + Case Reason).
 *
 * The same 4 tests run for every master data screen in ./targets.ts:
 *   TC01 create            – new record is Active, shown in the list, only "Deactivate" offered
 *   TC02 form validation   – unsaved-changes prompt, mandatory fields, uniqueness
 *   TC03 record lifecycle  – deactivate (cancel/proceed) → edit → activate → deactivate → delete (cancel/delete)
 *   TC04 bulk actions      – bulk button enablement + bulk deactivate / activate / delete
 *   TC07 listing           – column sort asc/desc, record counter
 * TC08 pagination runs once (Division): the pager is the same component on every list.
 *
 * Isolation: each test creates its own records with a unique key (PWT#########)
 * and the `md` fixture deactivates + deletes them afterwards.
 */
import { test, expect, settle } from './fixtures';
import { editValuesFor, expectSuccessToast, modal, valuesFor } from './pages';
import { targets } from './targets';

const tag = (name: string) => '@' + name.toLowerCase().replace(/\s+/g, '-');

for (const t of targets) {
  test.describe(`${t.name} (#${t.ticket})`, { tag: ['@masterdata', tag(t.name)] }, () => {
    test.use({ target: t });

    test('TC01 create: new record is Active, listed and only Deactivate is offered', async ({ md, page }) => {
      const list = md.list();
      await list.open();

      // Create from the list's "Create new …" button
      await page.getByRole('button', { name: t.createButton, exact: true }).click();
      await expect(page.getByText(t.createTitle).first()).toBeVisible();

      const k = await md.create();
      await list.find(k);

      await expect(list.row(k)).toHaveCount(1);
      const row = list.row(k);

      // FSD: listing columns (the table only renders when it has rows)
      const headers = (await page.locator('table thead th').allInnerTexts()).map(h => h.trim());
      for (const col of t.columns) expect.soft(headers, `column "${col}"`).toContain(col);
      for (const [label, value] of Object.entries(valuesFor(t, k))) {
        if (value) await expect(row, `row shows ${label}`).toContainText(value);
      }
      expect(await list.status(k)).toBe('Active');
      // FSD: "Last modified on/by" shows "-" until the record is modified
      await expect(row.locator('td[data-header="Last modified by"]')).toHaveText('-');
      // FSD: Edit and Delete are only for Inactive records
      expect(await list.menuItems(k)).toEqual(['Deactivate']);
    });

    test('TC02 form validation: unsaved changes, mandatory fields and uniqueness', async ({ md, page }) => {
      const form = md.form();
      await form.openCreate();
      await form.requireOptions();

      // 4.15 Unsaved changes: Cancel with data → prompt; stay keeps the data; Leave goes back
      const firstText = t.fields.find(f => f.kind === 'text')!;
      await form.input(firstText).fill('unsaved');
      await form.cancel();
      const prompt = modal(page, /unsaved changes/i);
      await expect(prompt).toBeVisible();
      await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(form.input(firstText)).toHaveValue('unsaved');
      await form.cancel();
      await modal(page, /unsaved changes/i).getByRole('button', { name: 'Leave', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${t.listPath}(\\?|$)`));

      // Mandatory fields: empty submit shows "This field is required." per mandatory field
      await form.openCreate();
      await form.submit();
      await settle(page);
      const required = t.fields.filter(f => f.required);
      await expect(page.getByText('This field is required.', { exact: true })).toHaveCount(required.length);
      await expect(page.getByText(t.createTitle).first()).toBeVisible(); // still on the form

      // Uniqueness: every unique field is checked on its own
      const existing = await md.create();
      for (const f of t.fields.filter(f => f.unique)) {
        const fresh = md.key();
        const values = valuesFor(t, fresh);
        values[f.label] = f.value(existing);           // clash on this field only
        await form.openCreate();
        await form.fill(values);
        md.created.push(fresh);                        // cleanup in case it is wrongly saved
        await form.submit();
        await settle(page);
        await expect(page.getByText(/already exists/i).first(), `duplicate "${f.label}" rejected`).toBeVisible();
        await expect(page.getByText(t.createTitle).first()).toBeVisible();
      }
    });

    test('TC03 lifecycle: deactivate, edit, activate, delete', async ({ md, page }) => {
      const list = md.list();
      const k = await md.create();
      await list.find(k);

      // Deactivate – Cancel and Close (X) keep the status (9.2.1)
      await list.rowAction(k, 'Deactivate');
      await list.confirmStatus('Deactivate', 'Cancel');
      expect(await list.status(k)).toBe('Active');
      await list.rowAction(k, 'Deactivate');
      await list.confirmStatus('Deactivate', 'Close');
      expect(await list.status(k)).toBe('Active');

      // Deactivate – Proceed
      await list.rowAction(k, 'Deactivate');
      await list.confirmStatus('Deactivate', 'Proceed');
      await expectSuccessToast(page);
      await list.find(k);
      expect(await list.status(k)).toBe('Inactive');
      expect((await list.menuItems(k)).sort()).toEqual(['Activate', 'Delete', 'Edit']);

      // Edit – form is pre-filled, Save and update stores the change
      await list.rowAction(k, 'Edit');
      await expect(page).toHaveURL(new RegExp(`/${t.formScreen}\\?\\w+=[1-9]`));
      await expect(page.getByText(t.editTitle).first()).toBeVisible();
      const form = md.form();
      await form.waitLoaded();
      const before = await form.values();
      for (const [label, v] of Object.entries(valuesFor(t, k))) if (v) expect(before[label], `pre-filled ${label}`).toBe(v);
      await form.fill(editValuesFor(t, k));
      await form.saveAndUpdate();
      await form.acceptSaveConfirmIfShown();
      await expect(page).toHaveURL(new RegExp(`/${t.listPath}(\\?|$)`));
      await expectSuccessToast(page);
      await list.find(k);
      for (const v of Object.values(editValuesFor(t, k))) await expect(list.row(k)).toContainText(v);
      await expect(list.row(k).locator('td[data-header="Last modified by"]')).not.toHaveText('-');
      expect(await list.status(k)).toBe('Inactive'); // status cannot change from the form

      // Activate – back to Active, Edit/Delete hidden again
      await list.rowAction(k, 'Activate');
      await list.confirmStatus('Activate', 'Proceed');
      await expectSuccessToast(page);
      await list.find(k);
      expect(await list.status(k)).toBe('Active');
      expect(await list.menuItems(k)).toEqual(['Deactivate']);

      // Delete – needs Inactive; Cancel keeps it, Delete removes it (9.2.2)
      await list.rowAction(k, 'Deactivate');
      await list.confirmStatus('Deactivate', 'Proceed');
      await list.waitStatus(k, 'Inactive');
      await list.rowAction(k, 'Delete');
      await list.confirmDelete('Cancel');
      await expect(list.row(k)).toHaveCount(1);
      await list.rowAction(k, 'Delete');
      await list.confirmDelete('Delete');
      await expectSuccessToast(page);
      await list.find(k);
      await expect(list.row(k)).toHaveCount(0);
    });

    test('TC04 bulk actions: button enablement, bulk deactivate/activate/delete', async ({ md, page }) => {
      const list = md.list();
      // Two records sharing an 11-char prefix, so one search shows both and nothing else
      const base = md.key().slice(0, -1);
      const a = await md.create(base + '1');
      const b = await md.create(base + '2');
      const showBoth = async () => {
        await list.find(base);
        await expect(list.row(a)).toHaveCount(1);
        await expect(list.row(b)).toHaveCount(1);
      };
      await showBoth();

      // Disabled by default
      for (const n of ['Activate', 'Deactivate', 'Delete'] as const) await expect(list.bulk(n)).toBeDisabled();

      // Two Active selected → only Deactivate enabled
      await list.select(a); await list.select(b);
      await expect(list.bulk('Deactivate')).toBeEnabled();
      await expect(list.bulk('Activate')).toBeDisabled();
      await expect(list.bulk('Delete')).toBeDisabled();
      await list.bulk('Deactivate').click();
      await list.confirmStatus('Deactivate', 'Proceed');
      await expectSuccessToast(page);
      await showBoth();
      expect(await list.status(a)).toBe('Inactive');
      expect(await list.status(b)).toBe('Inactive');

      // Two Inactive selected → Activate + Delete enabled, Deactivate disabled
      await list.select(a); await list.select(b);
      await expect(list.bulk('Activate')).toBeEnabled();
      await expect(list.bulk('Delete')).toBeEnabled();
      await expect(list.bulk('Deactivate')).toBeDisabled();

      // Bulk activate one, then mixed selection (Active + Inactive) disables all
      await list.select(b, false);
      await list.bulk('Activate').click();
      await list.confirmStatus('Activate', 'Proceed');
      await showBoth();
      expect(await list.status(a)).toBe('Active');
      await list.select(a); await list.select(b);
      for (const n of ['Activate', 'Deactivate', 'Delete'] as const) await expect(list.bulk(n)).toBeDisabled();

      // Make both Inactive again and bulk delete
      await list.select(b, false);
      await list.bulk('Deactivate').click();
      await list.confirmStatus('Deactivate', 'Proceed');
      await showBoth();
      await list.select(a); await list.select(b);
      await list.bulk('Delete').click();
      await list.confirmDelete('Delete');
      await expectSuccessToast(page);
      await list.find(base);
      await expect(list.row(a)).toHaveCount(0);
      await expect(list.row(b)).toHaveCount(0);
    });

    test('TC07 listing: sort ascending/descending and record counter', async ({ md }) => {
      const list = md.list();
      const base = md.key().slice(0, -1);
      const a = await md.create(base + '1');
      const b = await md.create(base + '2');
      await list.find(base);
      await expect(list.rows).toHaveCount(2);
      await expect(list.counter).toHaveText(/1\s*to\s*2\s*of\s*2\s*records/);

      const order = async () => (await list.columnValues(t.sortColumn)).map(v => (v.includes(a) ? 'a' : v.includes(b) ? 'b' : v));
      await list.sortBy(t.sortColumn);
      expect(await order(), 'ascending after 1st click').toEqual(['a', 'b']);
      await list.sortBy(t.sortColumn);
      expect(await order(), 'descending after 2nd click').toEqual(['b', 'a']);
      // Search still applies after sorting
      await expect(list.rows).toHaveCount(2);
    });
  });
}

/* ------------------------------------------------------------------ */
/* Pagination – same component on every list, so tested once          */
/* ------------------------------------------------------------------ */
test.describe('Pagination (10 per page)', { tag: ['@masterdata', '@pagination', '@division'] }, () => {
  test.use({ target: targets.find(x => x.ticket === 102)! });

  test('TC08 11 records show as 10 on page 1 and 1 on page 2', async ({ md }) => {
    test.setTimeout(12 * 60_000);
    const list = md.list();
    const base = md.key().slice(0, -2);
    const keys: string[] = [];
    for (let i = 1; i <= 11; i++) keys.push(await md.create(base + String(i).padStart(2, '0')));

    await list.find(base);
    await expect(list.rows).toHaveCount(10);
    await expect(list.counter).toHaveText(/1\s*to\s*10\s*of\s*11\s*records/);

    await list.pager.getByText('2', { exact: true }).click();
    await settle(list.page);
    await expect(list.rows).toHaveCount(1);
    await expect(list.counter).toHaveText(/11\s*to\s*11\s*of\s*11\s*records/);

    await list.pager.getByText('1', { exact: true }).click();
    await settle(list.page);
    await expect(list.rows).toHaveCount(10);
  });
});

/* ------------------------------------------------------------------ */
/* Screen-specific rules                                              */
/* ------------------------------------------------------------------ */
test.describe('Master data navigation (9.1)', { tag: '@masterdata' }, () => {
  test('TC05 side menu opens every master data screen', async ({ page }) => {
    await page.goto('');
    await settle(page);
    const links: [string, RegExp][] = [
      ['Divisions', /DivisionsManagement/], ['Departments', /DepartmentsManagement/],
      ['Sections', /SectionsManagement/], ['Groups', /GroupsManagement/],
      ['Store area teams', /StoreAreaTeamsManagement/], ['Cost centers', /CostCentersManagement/],
    ];
    for (const [name, url] of links) {
      await page.goto('DivisionsManagement'); // menu group is expanded on master data pages
      await settle(page);
      await page.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(url);
    }
    for (const t of targets) {
      await page.goto(t.listPath);
      await settle(page);
      await expect(page.getByRole('button', { name: t.createButton, exact: true }), t.name).toBeVisible();
    }
  });
});

test.describe('Task Type (#100) system types', { tag: ['@masterdata', '@task-type'] }, () => {
  test('TC06 system-created task types cannot be selected or changed', async ({ page }) => {
    const t = targets.find(x => x.ticket === 100)!;
    await page.goto(t.listPath);
    await settle(page);
    const systemTypes = ['Outstanding documents', 'Schedule review date'];
    let found = 0;
    for (const name of systemTypes) {
      await page.getByPlaceholder(t.searchPlaceholder).fill(name);
      await page.getByPlaceholder(t.searchPlaceholder).press('Enter');
      await settle(page);
      const rows = page.locator('table tbody tr').filter({ hasText: name });
      for (let i = 0; i < await rows.count(); i++) {
        found++;
        await expect(rows.nth(i).locator('input[type="checkbox"]').first()).toBeDisabled();
        const items = (await rows.nth(i).locator('.osui-overflow-menu__balloon a, .osui-overflow-menu__balloon button').allInnerTexts())
          .map(s => s.trim()).filter(Boolean);
        expect(items, `${name}: no actions`).toEqual([]);
      }
    }
    test.skip(found === 0, 'No system-created task types exist in this environment.');
  });
});
