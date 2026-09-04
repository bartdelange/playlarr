import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const webHost = '127.0.0.1';
const webPort = 3000;

const serverHost = '127.0.0.1';
const serverPort = 3001;

const baseURL = process.env['BASE_URL'] ?? `http://${webHost}:${webPort}`;

const e2eDatabasePath = join(tmpdir(), 'playlarr-e2e.sqlite');
/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import 'dotenv/config';

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * Generated as a .mts file so Node forces ESM regardless of workspace
 * `type`. Playwright routes `.mts` through its ESM loader (dynamic import,
 * bypassing the pirates CJS-compile path), and Nx's native TS strip loads
 * `.mts` directly. Playwright's configLoader auto-discovers
 * `playwright.config.mts` via its extension list
 * (.ts/.js/.mts/.mjs/.cts/.cjs).
 */
export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  globalSetup: './src/global-setup.ts',
  /* Run your local dev server before starting the tests */
  webServer: [
    {
      command: 'pnpm exec nx run @playlarr/server:serve',
      url: `http://${serverHost}:${serverPort}/api/health`,
      reuseExistingServer: true,
      cwd: workspaceRoot,
      env: {
        PLAYLARR_SERVER_HOST: serverHost,
        PLAYLARR_SERVER_PORT: String(serverPort),
        PLAYLARR_DATABASE_PATH: e2eDatabasePath,
      },
    },
    {
      command: 'pnpm exec nx run @playlarr/web:dev',
      url: baseURL,
      reuseExistingServer: true,
      cwd: workspaceRoot,
      env: {
        PLAYLARR_SERVER_HOST: serverHost,
        PLAYLARR_SERVER_PORT: String(serverPort),
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // Uncomment for mobile browsers support
    /* {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    }, */

    // Uncomment for branded browsers
    /* {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    } */
  ],
});
