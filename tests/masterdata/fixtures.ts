import { test as base, expect, Page } from '@playwright/test';
import { FormPage, ListPage, settle, valuesFor, expectSuccessToast } from './pages';
import { KEY_PATTERN, newKey, Target } from './targets';
import { ensureLoggedIn } from '../support/auth';

/**
 * Data helper for one test. Every record created through `create()` is
 * removed after the test (deactivate if Active, then delete), even if the
 * test fails half-way. Records are found again by their unique key.
 */
export class MasterData {
  readonly created: string[] = [];
  constructor(readonly page: Page, readonly t: Target, readonly worker: number) {}

  list() { return new ListPage(this.page, this.t); }
  form() { return new FormPage(this.page, this.t); }
  key() { return newKey(this.worker); }

  /** Create a record through the UI and return its key. Lands on the list page. */
  async create(k = this.key()) {
    const form = this.form();
    await form.openCreate();
    await form.requireOptions();
    await form.fill(valuesFor(this.t, k));
    this.created.push(k); // register before submit so cleanup runs even if submit half-works
    await form.submit();
    await expect(this.page).toHaveURL(new RegExp(`/${this.t.listPath}(\\?|$)`), { timeout: 30_000 });
    await expectSuccessToast(this.page);
    return k;
  }

  /** Best-effort removal of everything this test created. */
  async cleanup() {
    if (!this.created.length) return;
    const list = this.list();
    await ensureLoggedIn(this.page).catch(() => {});
    for (const k of this.created) {
      try {
        await list.open();
        await list.find(k);
        // A key can match more than one row only if a duplicate slipped through.
        for (let i = 0; i < 3 && (await list.row(k).count()) > 0; i++) {
          const text = this.t.rowKey(k);
          const row = list.row(k).first();
          const status = (await row.locator('td[data-header="Status"]').innerText()).trim();
          const exact = (await list.row(text).count()) === 1 ? text : k;
          if (/^Active$/i.test(status)) {
            await list.rowAction(exact, 'Deactivate');
            await list.confirmStatus('Deactivate', 'Proceed');
          }
          await list.rowAction(exact, 'Delete');
          await list.confirmDelete('Delete');
          await list.find(k);
        }
      } catch (e) {
        console.warn(`[cleanup] ${this.t.name} ${k}: ${String(e).split('\n')[0]}`);
      }
    }
  }
}

export const test = base.extend<{ md: MasterData; target: Target; relogin: void }>({
  target: [undefined as unknown as Target, { option: true }],
  // Sessions can expire during a long run: log in again before each test if needed.
  relogin: [async ({ page }, use) => { await ensureLoggedIn(page); await use(); }, { auto: true }],
  md: async ({ page, target }, use, testInfo) => {
    const md = new MasterData(page, target, testInfo.workerIndex);
    await use(md);
    await md.cleanup();
  },
});

export { expect, settle };

/** Remove every leftover test record (key PWT#########) from a list. Used by the teardown. */
export async function sweep(page: Page, t: Target) {
  const list = new ListPage(page, t);
  await list.open();
  await list.find('PWT');
  for (let guard = 0; guard < 50; guard++) {
    const row = list.rows.filter({ hasText: KEY_PATTERN }).first();
    if (!(await row.count())) break;
    const key = (await row.innerText()).match(KEY_PATTERN)![0];
    const status = (await row.locator('td[data-header="Status"]').innerText()).trim();
    if (/^Active$/i.test(status)) {
      await list.rowAction(key, 'Deactivate');
      await list.confirmStatus('Deactivate', 'Proceed');
    }
    await list.rowAction(key, 'Delete');
    await list.confirmDelete('Delete');
    await list.find('PWT');
  }
}
