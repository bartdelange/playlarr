import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:8787/health",
    reuseExistingServer: false,
    env: {
      DATA_DIR: "/private/tmp/playlarr-e2e/data",
      OUTPUT_DIR: "/private/tmp/playlarr-e2e/playlists",
      MUSICBRAINZ_USER_AGENT: "Playlarr e2e",
    },
  },
});
