import { defineConfig, devices } from '@playwright/test';

// TESTING.md §5: Playwright drives the real browser build with PLACEHOLDER_ART=1,
// because CI has no art (repo policy).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? 'list' : 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    env: { PLACEHOLDER_ART: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
