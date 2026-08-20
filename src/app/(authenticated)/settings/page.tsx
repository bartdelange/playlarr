import { connection } from "next/server";
import { Suspense } from "react";
import { existsSync } from "node:fs";
import { config, security, settings } from "../../../server/runtime";
import { changeAuthorization, changePassword } from "../../actions/security";
import {
  authenticateSpotify,
  authenticateTidal,
  savePathMappings,
  saveServiceSettings,
  testServiceConnection,
} from "../../actions/workflows";
import { requestCsrfToken } from "../../../server/security/request";
import { LidarrClient } from "../../../server/integrations/lidarr/client";
const secretPlaceholder = (value: unknown) =>
  value ? "Configured — enter to replace" : "Required";
export default function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  return (
    <main className="settings-page">
      <p className="eyebrow">Configuration</p>
      <h1>Settings</h1>
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SettingsContent({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  await connection();
  const query = await searchParams;
  const csrf = await requestCsrfToken();
  const saved = settings.all();
  const mappings = settings.get<[string, string][]>("path_mappings", [
    ["/music", "/music"],
  ]);
  const lidarrUrl = String(saved.lidarr_url ?? config.lidarr.url ?? "");
  const lidarrApiKey = String(
    saved.lidarr_api_key ?? config.lidarr.apiKey ?? "",
  );
  const lidarrConfigured = Boolean(lidarrUrl && lidarrApiKey);
  let rootFolders: { value: string; label: string }[] = [];
  let qualityProfiles: { value: number; label: string }[] = [];
  let metadataProfiles: { value: number; label: string }[] = [];
  let lidarrOptionsError: string | undefined;
  if (lidarrConfigured) {
    try {
      const lidarr = new LidarrClient({ url: lidarrUrl, apiKey: lidarrApiKey });
      [rootFolders, qualityProfiles, metadataProfiles] = await Promise.all([
        lidarr.rootFolders(),
        lidarr.qualityProfiles(),
        lidarr.metadataProfiles(),
      ]);
    } catch (error) {
      lidarrOptionsError = `Could not load Lidarr options: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const selectedRoot = String(
    saved.lidarr_root_folder ?? config.lidarr.rootFolder,
  );
  const selectedQuality = Number(
    saved.lidarr_quality_profile_id ?? config.lidarr.qualityProfileId,
  );
  const selectedMetadata = Number(
    saved.lidarr_metadata_profile_id ?? config.lidarr.metadataProfileId,
  );
  const navidromeConfigured = Boolean(
    (saved.navidrome_url ?? config.navidrome.url) &&
    (saved.navidrome_username ?? config.navidrome.username) &&
    (saved.navidrome_password ?? config.navidrome.password),
  );
  return (
    <>
      {(query.message || query.error) && (
        <p role="alert">{query.message ?? query.error}</p>
      )}
      <div className="settings-tabs">
        <input
          className="settings-tab-control"
          type="radio"
          name="settings-tab"
          id="services-tab"
          defaultChecked
        />
        <label className="settings-tab-label" htmlFor="services-tab">
          Services
        </label>
        <input
          className="settings-tab-control"
          type="radio"
          name="settings-tab"
          id="data-tab"
        />
        <label className="settings-tab-label" htmlFor="data-tab">
          Data Settings
        </label>
        <div className="settings-panel services-panel settings-grid">
          <ServiceForm title="MusicBrainz" service="musicbrainz" csrf={csrf}>
            <label>
              User-Agent
              <input
                name="mb_user_agent"
                defaultValue={String(
                  saved.mb_user_agent ?? config.musicBrainz.userAgent,
                )}
              />
            </label>
          </ServiceForm>
          <ServiceForm
            title="Spotify"
            service="spotify"
            csrf={csrf}
            status={
              existsSync(config.spotify.tokenCache)
                ? "Authenticated"
                : "Not authenticated"
            }
            statusOk={existsSync(config.spotify.tokenCache)}
          >
            <label>
              Client ID
              <input
                name="spotify_client_id"
                placeholder={secretPlaceholder(
                  saved.spotify_client_id ?? config.spotify.clientId,
                )}
              />
            </label>
            <label>
              Redirect URI
              <input
                name="spotify_redirect_uri"
                defaultValue={String(
                  saved.spotify_redirect_uri ?? config.spotify.redirectUri,
                )}
              />
            </label>
          </ServiceForm>
          <ServiceForm title="TIDAL" service="tidal" csrf={csrf} save={false}>
            <p className="muted">
              Playlist source using TIDAL device authentication.
            </p>
            <p>
              Session:{" "}
              <span
                className={`status ${existsSync(config.tidal.sessionFile) ? "ok" : ""}`}
              >
                {existsSync(config.tidal.sessionFile)
                  ? "Authenticated"
                  : "Not authenticated"}
              </span>
            </p>
          </ServiceForm>
          <ServiceForm
            title="Lidarr"
            service="lidarr"
            csrf={csrf}
            test
            status={lidarrConfigured ? "Configured" : "Not configured"}
            statusOk={lidarrConfigured}
          >
            <label>
              URL
              <input name="lidarr_url" defaultValue={lidarrUrl} />
            </label>
            <label>
              API key
              <input
                type="password"
                name="lidarr_api_key"
                placeholder={secretPlaceholder(
                  saved.lidarr_api_key ?? config.lidarr.apiKey,
                )}
              />
            </label>
            <label>
              Root folder
              <select
                name="lidarr_root_folder"
                defaultValue={selectedRoot}
                disabled={!lidarrConfigured}
              >
                {!rootFolders.some(
                  (option) => option.value === selectedRoot,
                ) && <option value={selectedRoot}>{selectedRoot}</option>}
                {rootFolders.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quality profile
              <select
                name="lidarr_quality_profile_id"
                defaultValue={String(selectedQuality)}
                disabled={!lidarrConfigured}
              >
                {!qualityProfiles.some(
                  (option) => option.value === selectedQuality,
                ) && (
                  <option value={selectedQuality}>
                    Profile {selectedQuality}
                  </option>
                )}
                {qualityProfiles.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Metadata profile
              <select
                name="lidarr_metadata_profile_id"
                defaultValue={String(selectedMetadata)}
                disabled={!lidarrConfigured}
              >
                {!metadataProfiles.some(
                  (option) => option.value === selectedMetadata,
                ) && (
                  <option value={selectedMetadata}>
                    Profile {selectedMetadata}
                  </option>
                )}
                {metadataProfiles.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {!lidarrConfigured && (
              <>
                <input
                  type="hidden"
                  name="lidarr_root_folder"
                  value={selectedRoot}
                />
                <input
                  type="hidden"
                  name="lidarr_quality_profile_id"
                  value={selectedQuality}
                />
                <input
                  type="hidden"
                  name="lidarr_metadata_profile_id"
                  value={selectedMetadata}
                />
                <small>
                  Save a Lidarr URL and API key to load these options.
                </small>
              </>
            )}
            {lidarrOptionsError && <small>{lidarrOptionsError}</small>}
          </ServiceForm>
          <ServiceForm
            title="Navidrome"
            service="navidrome"
            csrf={csrf}
            test
            status={navidromeConfigured ? "Configured" : "Not configured"}
            statusOk={navidromeConfigured}
          >
            <label>
              URL
              <input
                name="navidrome_url"
                defaultValue={String(
                  saved.navidrome_url ?? config.navidrome.url ?? "",
                )}
              />
            </label>
            <label>
              Username
              <input
                name="navidrome_username"
                placeholder={secretPlaceholder(
                  saved.navidrome_username ?? config.navidrome.username,
                )}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="navidrome_password"
                placeholder={secretPlaceholder(
                  saved.navidrome_password ?? config.navidrome.password,
                )}
              />
            </label>
          </ServiceForm>
        </div>
        <div className="settings-panel data-panel settings-grid">
          <section className="card">
            <h2>Playlist paths</h2>
            <form action={savePathMappings}>
              <input type="hidden" name="csrf_token" value={csrf} />
              <label>
                Lidarr path
                <input name="lidarr_prefix" defaultValue={mappings[0]?.[0]} />
              </label>
              <label>
                Consumer path
                <input name="consumer_prefix" defaultValue={mappings[0]?.[1]} />
              </label>
              <button>Save paths</button>
            </form>
          </section>
          <section className="card">
            <h2>Authentication</h2>
            <form action={changeAuthorization}>
              <input type="hidden" name="csrf_token" value={csrf} />
              <label>
                <input
                  type="checkbox"
                  name="authorization_enabled"
                  value="true"
                  defaultChecked={security.authorizationEnabled}
                />{" "}
                Enable password authorization
              </label>
              {!security.hasPassword && (
                <>
                  <input
                    type="password"
                    name="password"
                    placeholder="New password"
                  />
                  <input
                    type="password"
                    name="confirm_password"
                    placeholder="Confirm password"
                  />
                </>
              )}
              <button>Save authentication</button>
            </form>
            {security.authorizationEnabled && (
              <form action={changePassword}>
                <input type="hidden" name="csrf_token" value={csrf} />
                <h3>Change password</h3>
                <input
                  type="password"
                  name="current_password"
                  placeholder="Current password"
                  required
                />
                <input
                  type="password"
                  name="password"
                  placeholder="New password"
                  minLength={12}
                  required
                />
                <input
                  type="password"
                  name="confirm_password"
                  placeholder="Confirm password"
                  minLength={12}
                  required
                />
                <button>Change password</button>
              </form>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function SettingsSkeleton() {
  return <section className="card skeleton">Loading service settings…</section>;
}
function ServiceForm({
  title,
  service,
  csrf,
  children,
  save = true,
  test = false,
  status,
  statusOk = false,
}: {
  title: string;
  service: string;
  csrf: string;
  children: React.ReactNode;
  save?: boolean;
  test?: boolean;
  status?: string;
  statusOk?: boolean;
}) {
  const authenticate =
    service === "spotify"
      ? authenticateSpotify
      : service === "tidal"
        ? authenticateTidal
        : undefined;
  return (
    <section className="card">
      <h2>{title}</h2>
      <form action={saveServiceSettings}>
        <input type="hidden" name="csrf_token" value={csrf} />
        <input type="hidden" name="service" value={service} />
        {children}
        {save && <button>Save {title}</button>}
      </form>
      {authenticate && (
        <form action={authenticate}>
          <input type="hidden" name="csrf_token" value={csrf} />
          <button className="secondary">Authenticate {title}</button>
        </form>
      )}
      <div className="settings-block-footer">
        {status ? (
          <span className={`status ${statusOk ? "ok" : ""}`}>{status}</span>
        ) : (
          <span />
        )}
        {test && (
          <form action={testServiceConnection}>
            <input type="hidden" name="csrf_token" value={csrf} />
            <input type="hidden" name="service" value={service} />
            <button className="secondary">Test {title}</button>
          </form>
        )}
      </div>
    </section>
  );
}
