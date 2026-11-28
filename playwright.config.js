import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL },
  webServer: { command: 'npm run demo', url: baseURL, reuseExistingServer: false },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
