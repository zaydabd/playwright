/**
 * Known differences between the FSD and the current app.
 *
 * Each test asserts what the FSD says and is marked `test.fail()`, so the run
 * stays green while the gap exists. When the app is fixed the test "unexpectedly
 * passes" and goes red: then delete the `test.fail()` line.
 */
import { test, expect, settle } from './fixtures';
import { modal } from './pages';
import { targets } from './targets';

const taskType = targets.find(t => t.ticket === 100)!;
const division = targets.find(t => t.ticket === 102)!;
const department = targets.find(t => t.ticket === 103)!;

test.describe('FSD gaps', { tag: ['@masterdata', '@fsd-gap'] }, () => {
  test('GAP01 Task type priority options are Very High, High, Normal, Low (FSD 9.3)', async ({ page }) => {
    test.fail(true, 'App shows Urgent / High / Medium / Low');
    await page.goto(taskType.createPath);
    await settle(page);
    const options = (await page.getByLabel('Priority', { exact: true }).locator('option').allInnerTexts())
      .map(s => s.trim()).filter(s => !/^Select/i.test(s));
    expect(options).toEqual(['Very High', 'High', 'Normal', 'Low']);
  });

  test.describe(() => {
    test.use({ target: division });

    test('GAP02 Activate pop-up offers "Proceed" (FSD 9.2.1)', async ({ md, page }) => {
      test.fail(true, 'App Activate pop-up shows "OK" instead of "Proceed"');
      const list = md.list();
      const k = await md.create();
      await list.find(k);
      await list.rowAction(k, 'Deactivate');
      await list.confirmStatus('Deactivate', 'Proceed');
      await list.find(k);
      await list.rowAction(k, 'Activate');
      const m = modal(page, /Activate record/i);
      await expect(m.getByRole('button', { name: 'Proceed', exact: true })).toBeVisible({ timeout: 5000 });
      await m.getByRole('button', { name: 'Cancel', exact: true }).click();
    });

    test('GAP03 "Save and update" is disabled until a field changes (FSD 9.2.3)', async ({ md, page }) => {
      test.fail(true, 'App enables "Save and update" before any change');
      const list = md.list();
      const k = await md.create();
      await list.find(k);
      await list.rowAction(k, 'Deactivate');
      await list.confirmStatus('Deactivate', 'Proceed');
      await list.find(k);
      await list.rowAction(k, 'Edit');
      await md.form().waitLoaded();
      await expect(page.getByRole('button', { name: 'Save and update', exact: true })).toBeDisabled({ timeout: 5000 });
    });
  });

  test.describe(() => {
    test.use({ target: department });

    test('GAP04 Department list columns are "Department code" / "Department name" (FSD 9.6)', async ({ md, page }) => {
      test.fail(true, 'App shows "Code" / "Name"');
      const list = md.list();
      const k = await md.create();
      await list.find(k);
      const headers = (await page.locator('table thead th').allInnerTexts()).map(h => h.trim());
      expect(headers).toEqual(expect.arrayContaining(['Department code', 'Department name']));
    });
  });
});
