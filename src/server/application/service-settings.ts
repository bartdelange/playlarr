export interface ServiceSettingsStore {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
}

export const serviceFields: Record<string, string[]> = {
  musicbrainz: ["mb_user_agent"],
  spotify: ["spotify_client_id", "spotify_redirect_uri"],
  lidarr: [
    "lidarr_url",
    "lidarr_api_key",
    "lidarr_root_folder",
    "lidarr_quality_profile_id",
    "lidarr_metadata_profile_id",
  ],
  navidrome: ["navidrome_url", "navidrome_username", "navidrome_password"],
};

const retainedWhenBlank = new Set(["spotify_client_id", "lidarr_api_key", "navidrome_username", "navidrome_password"]);

export function saveServiceConfiguration(
  store: ServiceSettingsStore,
  service: string,
  submitted: Record<string, string>,
) {
  const fields = serviceFields[service];
  if (!fields) throw new Error(`unknown service settings: ${service}`);
  for (const key of fields) {
    const value = (submitted[key] ?? "").trim();
    if (!value && retainedWhenBlank.has(key)) continue;
    store.set(key, /^lidarr_(quality|metadata)_profile_id$/.test(key) ? Number(value || store.get(key, 1)) : value);
  }
}
