import { defineConfig, devices } from '@playwright/test';

/**
 * The local-only visual goldens (TESTING.md §5). Unlike `playwright.config.ts` this runs the
 * dev server **without** `PLACEHOLDER_ART`, so the shots are of the real Pack A art — which
 * is why the suite skips itself wherever `art_assets/` is absent, CI included.
 *
 * It uses its own port so it can never pick up (or be picked up by) the e2e server, whose
 * synthesized art would silently produce a different picture.
 */
export default defineConfig({
  testDir: 'tests/visual',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
