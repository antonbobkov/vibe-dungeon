import { defineConfig, devices } from '@playwright/test';

// TESTING.md §5: Playwright drives the real browser build with PLACEHOLDER_ART=1,
// because CI has no art (repo policy).
//
// On its own port, and never reusing whatever is already listening: a dev server someone is
// playing on serves *real* art, and the suite would then quietly assert placeholder colours
// against it. (That is exactly what happened once; the visual config has always done this.)
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? 'list' : 'html',
  use: {
    baseURL: 'http://localhost:5176',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5176 --strictPort',
    url: 'http://localhost:5176',
    reuseExistingServer: false,
    env: { PLACEHOLDER_ART: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
