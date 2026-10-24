import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
let localUrl;
try { localUrl=JSON.parse(fs.readFileSync(new URL('../.local/runtime.json',import.meta.url),'utf8')).webUrl; } catch {}
export default defineConfig({
  testDir: './e2e', workers: 1, timeout: 60000, use: {
    baseURL: process.env.CLOUDSPHERE_TEST_WEB_URL || localUrl || 'http://127.0.0.1:5173',
    launchOptions: process.env.CLOUDSPHERE_CHROMIUM_PATH ? { executablePath: process.env.CLOUDSPHERE_CHROMIUM_PATH, args: ['--no-sandbox'] } : {},
  },
});
