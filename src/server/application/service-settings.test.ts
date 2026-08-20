import { expect, it } from "vitest";
import { saveServiceConfiguration } from "../../server/application/service-settings";

it("clears non-secret settings while retaining blank secret replacements", () => {
  const values = new Map<string, unknown>([
    ["lidarr_url", "http://old"],
    ["lidarr_api_key", "secret"],
    ["lidarr_root_folder", "/music"],
  ]);
  const store = {
    get<T>(key: string, fallback: T) {
      return (values.get(key) as T) ?? fallback;
    },
    set(key: string, value: unknown) {
      values.set(key, value);
    },
  };

  saveServiceConfiguration(store, "lidarr", {
    lidarr_url: "",
    lidarr_api_key: "",
    lidarr_root_folder: "",
    lidarr_quality_profile_id: "2",
    lidarr_metadata_profile_id: "3",
  });

  expect(Object.fromEntries(values)).toMatchObject({
    lidarr_url: "",
    lidarr_api_key: "secret",
    lidarr_root_folder: "",
    lidarr_quality_profile_id: 2,
    lidarr_metadata_profile_id: 3,
  });
});
