import { connection } from "next/server";
import { config, security, settings } from "../../../server/runtime";
import { changeAuthorization, changePassword } from "../../actions/security";
import {
  authenticateSpotify,
  authenticateTidal,
  savePathMappings,
  saveServiceSettings,
} from "../../actions/workflows";
import { requestCsrfToken } from "../../../server/security/request";
const secretPlaceholder = (value: unknown) =>
  value ? "Configured — enter to replace" : "Required";
export default async function SettingsPage({
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
  return (
    <main className="settings-page">
      <p className="eyebrow">Configuration</p>
      <h1>Settings</h1>
      {(query.message || query.error) && (
        <p role="alert">{query.message ?? query.error}</p>
      )}
      <div className="settings-grid">
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
        <ServiceForm title="Spotify" service="spotify" csrf={csrf}>
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
        <ServiceForm title="TIDAL" service="tidal" csrf={csrf}>
          <label>
            Client ID
            <input
              name="tidal_client_id"
              placeholder={secretPlaceholder(saved.tidal_client_id)}
            />
          </label>
          <label>
            Redirect URI
            <input
              name="tidal_redirect_uri"
              defaultValue={String(
                saved.tidal_redirect_uri ??
                  "http://127.0.0.1:8787/api/tidal/callback",
              )}
            />
          </label>
        </ServiceForm>
        <ServiceForm title="Lidarr" service="lidarr" csrf={csrf}>
          <label>
            URL
            <input
              name="lidarr_url"
              defaultValue={String(saved.lidarr_url ?? config.lidarr.url ?? "")}
            />
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
            <input
              name="lidarr_root_folder"
              defaultValue={String(
                saved.lidarr_root_folder ?? config.lidarr.rootFolder,
              )}
            />
          </label>
          <label>
            Quality profile ID
            <input
              name="lidarr_quality_profile_id"
              type="number"
              min="1"
              defaultValue={String(
                saved.lidarr_quality_profile_id ??
                  config.lidarr.qualityProfileId,
              )}
            />
          </label>
          <label>
            Metadata profile ID
            <input
              name="lidarr_metadata_profile_id"
              type="number"
              min="1"
              defaultValue={String(
                saved.lidarr_metadata_profile_id ??
                  config.lidarr.metadataProfileId,
              )}
            />
          </label>
        </ServiceForm>
        <ServiceForm title="Navidrome" service="navidrome" csrf={csrf}>
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
    </main>
  );
}
function ServiceForm({
  title,
  service,
  csrf,
  children,
}: {
  title: string;
  service: string;
  csrf: string;
  children: React.ReactNode;
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
        <button>Save {title}</button>
      </form>
      {authenticate && (
        <form action={authenticate}>
          <input type="hidden" name="csrf_token" value={csrf} />
          <button className="secondary">Authenticate {title}</button>
        </form>
      )}
    </section>
  );
}
