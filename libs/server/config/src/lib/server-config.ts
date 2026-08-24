interface DatabaseConfig {
  path: string;
}

export interface AppConfig {
  database: DatabaseConfig;
  // spotify: SpotifyConfig;
  // tidal: TidalConfig;
  // lidarr: LidarrConfig;
  // navidrome: NavidromeConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    database: {
      path: env.PLAYLARR_DATABASE_PATH ?? './data/playlarr.db',
    },
  };
}
