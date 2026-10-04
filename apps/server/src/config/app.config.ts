import { registerAs } from '@nestjs/config';

export interface AppConfig {
  auth: {
    enabled: boolean;
    passwordHash: string;
    sessionLifetimeSeconds: number;
    username: string;
  };
  database: {
    path: string;
  };
  server: {
    host: string;
    port: number;
  };
}

export const appConfig = registerAs('app', (): AppConfig => ({
  auth: {
    enabled: process.env['PLAYLARR_AUTH_ENABLED'] === 'true',
    passwordHash: process.env['PLAYLARR_AUTH_PASSWORD_HASH'] ?? '',
    sessionLifetimeSeconds: Number(
      process.env['PLAYLARR_AUTH_SESSION_LIFETIME_SECONDS'] ?? 2_592_000,
    ),
    username: process.env['PLAYLARR_AUTH_USERNAME'] ?? '',
  },
  database: {
    path: process.env['PLAYLARR_DATABASE_PATH'] ?? './data/playlarr.db',
  },
  server: {
    host: process.env['PLAYLARR_SERVER_HOST'] ?? '0.0.0.0',
    port: Number(process.env['PLAYLARR_SERVER_PORT'] ?? 3001),
  },
}));
