import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config/environment";

describe("configuration", () => {
  it("preserves the existing storage and service environment names", () => {
    const config = loadConfig({
      DATA_DIR: "/config/data",
      LIDARR_URL: "http://lidarr/",
      LIDARR_QUALITY_PROFILE_ID: "4",
    });
    expect(config.databasePath).toBe("/config/data/music-importer.db");
    expect(config.lidarr).toMatchObject({
      url: "http://lidarr",
      qualityProfileId: 4,
    });
  });
});
