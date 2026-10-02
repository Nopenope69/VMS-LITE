import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end test against a running stack (see e2e/stack.sh).
 *   E2E_BASE_URL          app address (default http://127.0.0.1:3100)
 *   E2E_CHROMIUM_PATH     use this Chromium binary instead of Google Chrome
 *   E2E_PLAYBACK_DECODE=0 with such a Chromium: open-source builds cannot play MP4
 *                         files, so recorded playback is checked up to the server
 *                         response only
 *
 * By default it runs Google Chrome (installed on GitHub's Ubuntu runners), which plays
 * recordings like the browsers customers use.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: '../test-results',
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.E2E_CHROMIUM_PATH ? undefined : 'chrome',
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
      // Lets headless Chromium start WebRTC/media playback without a user gesture
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
});
