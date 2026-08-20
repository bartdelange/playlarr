import { defineConfig } from "@playwright/test";

const port = process.env.PLAYLARR_E2E_PORT ?? "8787";
const baseURL = `http://127.0.0.1:${port}`;
const serverCommand = process.env.PLAYLARR_E2E_SERVER_COMMAND ?? "dev";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run ${serverCommand} -- --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    env: {
      DATA_DIR: "/private/tmp/playlarr-e2e/data",
      OUTPUT_DIR: "/private/tmp/playlarr-e2e/playlists",
      MUSICBRAINZ_USER_AGENT: "Playlarr e2e",
      LIDARR_QUALITY_PROFILE_ID: "1",
      LIDARR_METADATA_PROFILE_ID: "1",
    },
  },
});
