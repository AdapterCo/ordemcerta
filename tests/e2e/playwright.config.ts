import { defineConfig, devices } from '@playwright/test';

/**
 * E2E contra a stack em execução (docker compose ou VPS de homologação).
 *   E2E_BASE_URL=https://homolog.exemplo E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=... pnpm test:e2e
 */
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});
