import { test as setup } from '@playwright/test';
import fs from 'node:fs';
import { AUTH_FILE, login } from './support/auth';

setup('log in to BCMS Web', async ({ page }) => {
  fs.mkdirSync('.auth', { recursive: true });
  await page.goto(process.env.LOGIN_PATH || 'Login');
  await login(page);
  await page.context().storageState({ path: AUTH_FILE });
});
