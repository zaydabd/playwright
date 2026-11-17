import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';

const AUTH_FILE = '.auth/user.json';

setup('log in to BCMS Web', async ({ page }) => {
  // GitHub secrets: AVE_USERNAME / AVE_PASSWORD. Local .env: TEST_USER / TEST_PASSWORD also work.
  const user = process.env.AVE_USERNAME || process.env.TEST_USER;
  const pass = process.env.AVE_PASSWORD || process.env.TEST_PASSWORD;
  if (!user || !pass) throw new Error('Set AVE_USERNAME and AVE_PASSWORD (or TEST_USER/TEST_PASSWORD in .env).');

  fs.mkdirSync('.auth', { recursive: true });
  await page.goto(process.env.LOGIN_PATH || 'Login');

  await page.locator('#Input_UsernameVal').fill(user);
  await page.locator('#Input_Password').fill(pass);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();

  // Logged in when we leave the Login screen and the Log out button is rendered.
  await expect(page).not.toHaveURL(/\/Login(\?|$)/i, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible({ timeout: 60_000 });

  await page.context().storageState({ path: AUTH_FILE });
});
