import path from "node:path";

type Environment = Record<string, string | undefined>;

function integer(
  environment: Environment,
  name: string,
  fallback: number,
): number {
  const value = Number.parseInt(environment[name] ?? String(fallback), 10);
  if (Number.isNaN(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function number(
  environment: Environment,
  name: string,
  fallback: number,
): number {
  const value = Number.parseFloat(environment[name] ?? String(fallback));
  if (Number.isNaN(value)) throw new Error(`${name} must be a number`);
  return value;
}

const optional = (value: string | undefined) => value?.trim() || undefined;
const withoutTrailingSlash = (value: string | undefined) =>
  optional(value)?.replace(/\/+$/, "");

export interface AppConfig {
  dataDir: string;
  databasePath: string;
  outputDir: string;
  musicBrainz: {
    baseUrl: string;
    userAgent: string;
    requestDelay: number;
    timeout: number;
    maxRetries: number;
  };
  spotify: { clientId?: string; redirectUri: string; tokenCache: string };
  tidal: { sessionFile: string };
  lidarr: {
    url?: string;
    apiKey?: string;
    qualityProfileId: number;
    metadataProfileId: number;
    rootFolder: string;
  };
  navidrome: { url?: string; username?: string; password?: string };
  webAuthEnabled: boolean;
}

export function loadConfig(environment: Environment = process.env): AppConfig {
  const dataDir = environment.DATA_DIR ?? ".data";
  return {
    dataDir,
    databasePath: path.join(dataDir, "music-importer.db"),
    outputDir: environment.OUTPUT_DIR ?? "output",
    musicBrainz: {
      baseUrl: (
        environment.MUSICBRAINZ_BASE_URL ?? "https://musicbrainz.org/ws/2"
      ).replace(/\/+$/, ""),
      userAgent: environment.MUSICBRAINZ_USER_AGENT?.trim() ?? "",
      requestDelay: number(environment, "MUSICBRAINZ_REQUEST_DELAY", 1.1),
      timeout: number(environment, "MUSICBRAINZ_REQUEST_TIMEOUT", 30),
      maxRetries: integer(environment, "MUSICBRAINZ_MAX_RETRIES", 5),
    },
    tidal: {
      sessionFile:
        environment.TIDAL_SESSION_FILE ?? ".secrets/tidal-session.json",
    },
    spotify: {
      clientId: optional(environment.SPOTIFY_CLIENT_ID),
      redirectUri:
        environment.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:8787/callback",
      tokenCache:
        environment.SPOTIFY_TOKEN_CACHE ?? ".secrets/spotify-token.json",
    },
    lidarr: {
      url: withoutTrailingSlash(environment.LIDARR_URL),
      apiKey: optional(environment.LIDARR_API_KEY),
      qualityProfileId: integer(environment, "LIDARR_QUALITY_PROFILE_ID", 1),
      metadataProfileId: integer(environment, "LIDARR_METADATA_PROFILE_ID", 1),
      rootFolder: environment.LIDARR_ROOT_FOLDER ?? "/music",
    },
    navidrome: {
      url: withoutTrailingSlash(environment.NAVIDROME_URL),
      username: optional(environment.NAVIDROME_USERNAME),
      password: optional(environment.NAVIDROME_PASSWORD),
    },
    webAuthEnabled: !["0", "false", "no"].includes(
      (environment.PLAYLARR_AUTH_ENABLED ?? "true").toLowerCase(),
    ),
  };
}
