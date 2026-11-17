import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

const BASE_URL = process.env.BASE_URL || 'https://avepoint-dev.outsystems.app/BCMS_Web/';
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  timeout: Number(process.env.EXPLORER_TIMEOUT_MS || 25 * 60 * 1000),
  fullyParallel: false,
  workers: Number(process.env.WORKERS || 1),
  retries: 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    // Traces/videos are expensive on Actions runners and can leak data; keep off.
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'explorer',
      testMatch: /explorer\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: '.auth/user.json' },
    },
    {
      name: 'masterdata',
      testDir: './tests/masterdata',
      testMatch: /\.spec\.ts$/,
      testIgnore: /\.teardown\.ts$/,
      dependencies: ['setup'],
      teardown: 'masterdata-cleanup',
      fullyParallel: true,
      timeout: 5 * 60 * 1000,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: '.auth/user.json' },
    },
    {
      name: 'masterdata-cleanup',
      testDir: './tests/masterdata',
      testMatch: /cleanup\.teardown\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: '.auth/user.json' },
    },
  ],
});
