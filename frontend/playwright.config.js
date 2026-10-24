import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', workers: 1, timeout: 60000, use: {
    baseURL: process.env.CLOUDSPHERE_TEST_WEB_URL || 'http://127.0.0.1:5173',
    launchOptions: process.env.CLOUDSPHERE_CHROMIUM_PATH ? { executablePath: process.env.CLOUDSPHERE_CHROMIUM_PATH, args: ['--no-sandbox'] } : {},
  },
});
