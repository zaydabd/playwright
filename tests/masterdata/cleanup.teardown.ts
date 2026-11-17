/** Runs after the master data tests: removes test records left behind by crashed tests. */
import { test as teardown } from '@playwright/test';
import { ensureLoggedIn } from '../support/auth';
import { sweep } from './fixtures';
import { targets } from './targets';

for (const t of targets) {
  teardown(`remove leftover PWT records: ${t.name}`, async ({ page }) => {
    await ensureLoggedIn(page);
    await sweep(page, t);
  });
}
