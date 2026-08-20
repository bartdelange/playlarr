import type { AppConfig } from "../config/environment";
import type { SettingsRepository } from "../persistence/settings-repository";
import { FileSpotifyTokenStore, SpotifyAuthenticator } from "./spotify/auth";
import { SpotifySource } from "./spotify/source";
import { TidalAuthenticator } from "./tidal/auth";
import { FileTidalSessionStore } from "./tidal/session";
import { TidalSource } from "./tidal/source";
export function spotifyProvider(
  config: AppConfig,
  settings: SettingsRepository,
) {
  const auth = new SpotifyAuthenticator(
    settings.get("spotify_client_id", config.spotify.clientId ?? ""),
    settings.get("spotify_redirect_uri", config.spotify.redirectUri),
    new FileSpotifyTokenStore(config.spotify.tokenCache),
  );
  return { auth, source: new SpotifySource(auth) };
}
export function tidalProvider(config: AppConfig, settings: SettingsRepository) {
  const auth = new TidalAuthenticator(
    settings.get("tidal_client_id", ""),
    settings.get(
      "tidal_redirect_uri",
      "http://127.0.0.1:8787/api/tidal/callback",
    ),
    ["playlists.read"],
    new FileTidalSessionStore(config.tidal.sessionFile),
  );
  return { auth, source: new TidalSource(auth) };
}
