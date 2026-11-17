import { expect, Page } from '@playwright/test';

export const AUTH_FILE = '.auth/user.json';

export function credentials() {
  // GitHub secrets: AVE_USERNAME / AVE_PASSWORD. Local .env: TEST_USER / TEST_PASSWORD also work.
  const user = process.env.AVE_USERNAME || process.env.TEST_USER;
  const pass = process.env.AVE_PASSWORD || process.env.TEST_PASSWORD;
  if (!user || !pass) throw new Error('Set AVE_USERNAME and AVE_PASSWORD (or TEST_USER/TEST_PASSWORD in .env).');
  return { user, pass };
}

export const isLoginPage = (page: Page) => /\/Login(\?|$)/i.test(new URL(page.url()).pathname);

/** Log in with username + password and wait for the app shell. */
export async function login(page: Page) {
  const { user, pass } = credentials();
  if (!isLoginPage(page)) await page.goto(process.env.LOGIN_PATH || 'Login');
  await page.locator('#Input_UsernameVal').fill(user);
  await page.locator('#Input_Password').fill(pass);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/Login(\?|$)/i, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible({ timeout: 60_000 });
}

/** Open the app; if the session expired, log in again. */
export async function ensureLoggedIn(page: Page) {
  await page.goto('');
  await page.waitForLoadState('domcontentloaded');
  const loggedIn = page.getByRole('button', { name: 'Log out' });
  const loginBox = page.locator('#Input_UsernameVal');
  await expect(loggedIn.or(loginBox).first()).toBeVisible({ timeout: 45_000 });
  if (await loginBox.isVisible()) await login(page);
}
