import { expect, Locator, Page, test } from '@playwright/test';
import { Field, Target } from './targets';

const SETTLE_MS = Number(process.env.SLOW_SCREEN_MS || 1000);

export async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}

/** OutSystems feedback message (toast). */
export const toast = (page: Page) => page.locator('[class*="feedback-message"]').filter({ hasText: /\S/ }).first();

export async function expectSuccessToast(page: Page) {
  await expect(toast(page)).toContainText(/success/i, { timeout: 15_000 });
}

/** The confirmation modal (not the row action balloon, which is also role=dialog). */
export const modal = (page: Page, title: RegExp) => page.getByRole('dialog').filter({ hasText: title });

/* ------------------------------------------------------------------ */
/* List page                                                          */
/* ------------------------------------------------------------------ */
export class ListPage {
  constructor(readonly page: Page, readonly t: Target) {}

  async open() {
    await this.page.goto(this.t.listPath);
    await settle(this.page);
    await expect(this.page.getByRole('button', { name: this.t.createButton, exact: true })).toBeVisible();
  }

  get search() { return this.page.getByPlaceholder(this.t.searchPlaceholder, { exact: true }); }
  get rows() { return this.page.locator('table tbody tr'); }
  row(text: string) { return this.rows.filter({ hasText: text }); }
  bulk(name: 'Activate' | 'Deactivate' | 'Delete') {
    return this.page.getByRole('button', { name, exact: true });
  }

  /** Search and wait for the list to refresh (search is debounced; Enter is harmless). */
  async find(text: string) {
    await this.search.fill(text);
    await this.search.press('Enter');
    await settle(this.page);
  }

  async status(text: string) {
    return (await this.row(text).locator('td[data-header="Status"]').innerText()).trim();
  }

  /** Click a sortable column header (FSD: 1st click ascending, 2nd descending). */
  async sortBy(column: string) {
    await this.page.locator('table thead th.sortable').filter({ hasText: new RegExp(`^\\s*${column}\\s*$`) }).click();
    await settle(this.page);
  }

  /** Text of one column for every visible row, top to bottom. */
  async columnValues(column: string) {
    return (await this.rows.locator(`td[data-header="${column}"]`).allInnerTexts()).map(s => s.trim());
  }

  /** Pagination counter, e.g. "1 to 10 of 11 records". */
  get counter() { return this.page.locator('.pagination-counter').first(); }

  /** Pagination page buttons. */
  get pager() { return this.page.getByRole('navigation', { name: 'Pagination' }); }

  /** Re-search until the row shows `status` (the list can refresh late after a status change). */
  async waitStatus(text: string, status: 'Active' | 'Inactive') {
    await expect.poll(async () => {
      await this.find(text);
      return this.status(text).catch(() => '');
    }, { timeout: 30_000, intervals: [0, 1000, 2000] }).toBe(status);
  }

  /** Items in the row "…" menu (read without clicking; balloon is in the DOM). */
  async menuItems(text: string) {
    return (await this.row(text).locator('.osui-overflow-menu__balloon').locator('a, button').allInnerTexts())
      .map(s => s.trim()).filter(Boolean);
  }

  async rowAction(text: string, action: 'Edit' | 'Activate' | 'Deactivate' | 'Delete') {
    const row = this.row(text);
    await row.locator('.osui-overflow-menu__trigger').click();
    await row.locator('.osui-overflow-menu__balloon').getByText(action, { exact: true }).click();
  }

  async select(text: string, on = true) {
    const cb = this.row(text).locator('input[type="checkbox"]').first();
    if (on) await cb.check(); else await cb.uncheck();
  }

  /** Confirm or cancel the Activate/Deactivate pop-up (FSD 9.2.1). */
  async confirmStatus(kind: 'Activate' | 'Deactivate', choice: 'Proceed' | 'Cancel' | 'Close') {
    const m = modal(this.page, new RegExp(`${kind} record`, 'i'));
    await expect(m).toBeVisible();
    if (choice === 'Close') await m.getByRole('button').first().click(); // (X)
    // FSD says "Proceed"; the app's Activate pop-up currently uses "OK" (see fsd-gaps.spec.ts)
    else if (choice === 'Proceed') await m.getByRole('button', { name: /^(Proceed|OK)$/ }).click();
    else await m.getByRole('button', { name: choice, exact: true }).click();
    await expect(m).toBeHidden();
    await settle(this.page);
  }

  /** Confirm or cancel the Delete pop-up (FSD 9.2.2). */
  async confirmDelete(choice: 'Delete' | 'Cancel') {
    const m = modal(this.page, /Delete record/i);
    await expect(m).toBeVisible();
    await m.getByRole('button', { name: choice, exact: true }).click();
    await expect(m).toBeHidden();
    await settle(this.page);
  }
}

/* ------------------------------------------------------------------ */
/* Create / edit form                                                 */
/* ------------------------------------------------------------------ */
export class FormPage {
  constructor(readonly page: Page, readonly t: Target) {}

  async openCreate() {
    await this.page.goto(this.t.createPath);
    await settle(this.page);
    await expect(this.page.getByText(this.t.createTitle).first()).toBeVisible();
  }

  input(f: Field) { return this.page.getByLabel(f.label, { exact: true }); }

  /** Skip the test if a dropdown has no real options (e.g. Case action not configured). */
  async requireOptions() {
    for (const f of this.t.fields.filter(f => f.kind === 'select')) {
      const n = await this.input(f).locator('option').count();
      test.skip(n <= 1, `"${f.label}" dropdown has no options in this environment – screen not ready.`);
    }
  }

  async fill(values: Record<string, string>) {
    for (const f of this.t.fields) {
      const v = values[f.label];
      if (v === undefined) continue;
      if (f.kind === 'select') {
        if (v) await this.input(f).selectOption({ label: v });
        else await this.input(f).selectOption({ index: 1 }); // first real option
      } else {
        await this.input(f).fill(v);
      }
    }
  }

  /** Wait until the edit form has loaded the record (first required text field filled). */
  async waitLoaded() {
    const f = this.t.fields.find(f => f.required && f.kind === 'text')!;
    await expect(this.input(f)).not.toHaveValue('', { timeout: 20_000 });
    await settle(this.page);
  }

  async values() {
    const out: Record<string, string> = {};
    for (const f of this.t.fields) {
      out[f.label] = f.kind === 'select'
        ? await this.input(f).evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex]?.text.trim() ?? '')
        : await this.input(f).inputValue();
    }
    return out;
  }

  submit() { return this.page.getByRole('button', { name: this.t.submitButton, exact: true }).click(); }
  saveAndUpdate() { return this.page.getByRole('button', { name: 'Save and update', exact: true }).click(); }
  cancel() { return this.page.getByRole('button', { name: 'Cancel', exact: true }).click(); }

  /** Some FSD flows (9.2.3) ask for confirmation before saving; accept it if shown. */
  async acceptSaveConfirmIfShown() {
    const m = modal(this.page, /save changes/i);
    if (await m.isVisible({ timeout: 2000 }).catch(() => false)) {
      await m.getByRole('button', { name: /save changes/i }).click();
    }
  }

  requiredError(f: Field): Locator {
    // Inline message rendered next to / under the field.
    return this.page.locator('.form-group, [data-container]')
      .filter({ has: this.input(f) })
      .last()
      .getByText('This field is required.', { exact: true });
  }
}

export const valuesFor = (t: Target, k: string) =>
  Object.fromEntries(t.fields.map(f => [f.label, f.value(k)]));

export const editValuesFor = (t: Target, k: string) =>
  Object.fromEntries(t.fields.filter(f => f.editValue).map(f => [f.label, f.editValue!(k)]));
